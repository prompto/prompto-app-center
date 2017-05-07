ace.define('ace/mode/prompto_highlight_rules',["require","exports","module","ace/lib/oop","ace/mode/text_highlight_rules"], function(require, exports, module) {

    var oop = require("ace/lib/oop");
    var TextHighlightRules = require("ace/mode/text_highlight_rules").TextHighlightRules;

    var PromptoHighlightRules = function() {

        var controls = (
            "always|break|case|catch|default|do|each|else|except|finally|for|from|if|" +
            "on|otherwise|raise|return|switch|throw|to|try|with|when|where|while"
        );

        var types = (
            "Java|C#|Python2|Python3|JavaScript|Swift|Any|Blob|Boolean|Character|Text|" +
            "Image|Integer|Decimal|Date|Time|DateTime|Period|Method|Code|Document|" +
            "attr|attribute|attributes|bindings|enum|category|class|getter|" +
            "method|methods|operator|resource|setter|singleton|test"
        );

        var modifiers = (
            "abstract|desc|descending|enumerated|extends|mutable|native|storable"
        );

        var operators = (
            "and|in|is|modulo|not|or"
        );

        var other = (
            "all|any|as|contains|def|define|doing|expecting|" +
            "index|matching|receiving|returning|verifying"
        );

        var functions = (
            "write|read|close|open|execute|invoke|pass|fetch|flush|sorted|store"
        );

        var constants = (
            "True|true|False|false|None|Nothing|nothing|null|self|this"
        );

        var keywordMapper = this.createKeywordMapper({
            "keyword.control": controls,
            "keyword.operator": operators,
            "keyword.other": other,
            "storage.type": types,
            "storage.modifier": modifiers,
            "support.function": functions,
            "constant.language": constants
        }, "identifier");


        this.$rules = {
            "start": [
                {
                    token : "comment",
                    regex : "\\/\\/.*\\n"
                },
                {
                    token : "string", // text literal
                    regex : '["](?:(?:\\\\.)|(?:[^"\\\\]))*?["]'
                },
                {
                    token : "string", // date, time, character...
                    regex : "['](?:(?:\\\\.)|(?:[^'\\\\]))*?[']"
                },
                {
                    token: keywordMapper,
                    regex: "C#|[a-zA-Z][a-zA-Z0-9]*\\b"
                },
                {
                    token : "constant.numeric", // hex
                    regex : "0[xX][0-9a-fA-F]+\\b"
                },
                {
                    token: "constant.numeric", // float
                    regex: "[+-]?\\d+(?:(?:\\.\\d*)?(?:[eE][+-]?\\d+)?)?\\b"
                },
                {
                    token : "keyword.operator",
                    regex : "!|%|\\\\|/|\\*|\\-|\\+|~=|==|<>|!=|<=|>=|=|<|>|&&|\\|\\|"
                },
                {
                    token : "punctuation.operator",
                    regex : "\\?|\\:|\\,|\\;|\\."
                },
                {
                    token : "paren.lparen",
                    regex : "[[({]"
                },
                {
                    token : "paren.rparen",
                    regex : "[\\])}]"
                },
                {
                    token : "text",
                    regex : "\\s+"
                }
            ]
        };

    };

    oop.inherits(PromptoHighlightRules, TextHighlightRules);

    exports.PromptoHighlightRules = PromptoHighlightRules;
});

ace.define('ace/mode/prompto',["require","exports","module","ace/range","ace/lib/oop","ace/mode/text","ace/mode/prompto_highlight_rules","ace/worker/worker_client"], function(require, exports, module) {

    var oop = require("ace/lib/oop");
    var TextMode = require("ace/mode/text").Mode;
    var PromptoHighlightRules = require("ace/mode/prompto_highlight_rules").PromptoHighlightRules;
    var WorkerClient = require("ace/worker/worker_client").WorkerClient;
    var Range = ace.require("ace/range").Range;

    var Mode = function() {
        this.HighlightRules = PromptoHighlightRules;
    };
    oop.inherits(Mode, TextMode);

    (function() {

        this.setDialect = function(dialect) {
            this.$dialect = dialect;
            this.$worker && this.$worker.send("setDialect", [ this.$dialect ] );
        };

        this.setContent = function(content) {
            this.$worker && this.$worker.send("setContent", [ content ] );
        };

        this.destroy = function(content) {
            this.$worker && this.$worker.send("destroy", [ content ] );
        };

        this.setProject = function(dbId, loadDependencies) {
            this.$worker && this.$worker.send("setProject", [ dbId, loadDependencies ] );
        };

        this.commit = function(dbId) {
            this.$worker && this.$worker.send("commit", [ dbId ] );
        };

        this.runMethod = function(id, mode) {
            this.$worker && this.$worker.send("runMethod", [ id, mode ] );
        };

        // a utility method to inspect worker data in Firefox/Safari
        this.inspect = function(name) {
            this.$worker && this.$worker.send("inspect", [ name ] );
        };

        this.createWorker = function(session) {
            this.$worker = new WorkerClient(["ace"], "ace/worker/prompto", "PromptoWorker", "../js/ide/worker-prompto.js");
            this.$worker.send("setDialect", [ this.$dialect ] );
            this.$worker.attachToDocument(session.getDocument());

            var $markers = [];

            this.$worker.on("errors", function(e) {
                session.setAnnotations(e.data);
            });

            this.$worker.on("annotate", function(e) {
                session.setAnnotations(e.data);
                while($markers.length)
                    session.removeMarker($markers.pop());
                e.data.map( function(a) {
                    var range = new Range(a.row, a.column, a.endRow, a.endColumn);
                    var marker = session.addMarker(range, "ace_error-word", "text", true);
                    $markers.push(marker);
                });
            });

            this.$worker.on("terminate", function() {
                session.clearAnnotations();
            });

            this.$worker.on("value", function(v) {
                session.setValue(v.data);
                session.$editor.focus();
                session.$editor.focus();
            });

            this.$worker.on("catalog", function(v) {
                parent.catalogUpdated(v.data);
            });

            this.$worker.on("done", function(v) {
                parent.done(v.data);
            });

            // a utility method to inspect worker data in Firefox/Safari
            this.$worker.on("inspected", function(v) {
                parent.inspected(v.data);
            });

            return this.$worker;

        };

        this.$id = "ace/mode/prompto";

    }).call(Mode.prototype);

    exports.Mode = Mode;
});

