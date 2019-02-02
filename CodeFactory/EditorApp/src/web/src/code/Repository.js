import { parse } from './Utils';

/* a class to maintain an up-to-date copy of the repository */
/* which can be used to detect required changes in the UI, and deltas to commit */
export default class Repository {

    constructor() {
        this.librariesContext = prompto.runtime.Context.newGlobalContext();
        this.projectContext = prompto.runtime.Context.newGlobalContext();
        this.projectContext.setParentContext(this.librariesContext);
        this.moduleId = null;
        this.lastSuccess = ""; // last piece of code successfully registered through handleUpdate
        this.lastDialect = "E";
        this.statuses = {};
    }


    registerLibraryCode(code, dialect) {
        var decls = parse(code, dialect);
        decls.register(this.librariesContext);
    }

    registerLibraryDeclarations(declarations) {
        var worker = this;
        declarations.map(function (obj) {
            var decl = parse(obj.value.body, obj.value.dialect);
            decl.register(worker.librariesContext);
        });
    };

    publishLibraries() {
        return {
            removed: {},
            added: this.librariesContext.getCatalog(),
            core: true
        };
    };


    publishProject() {
        return {
            removed: {},
            added: this.projectContext.getLocalCatalog()
        };
    };


    unpublishProject() {
        var delta = {
            removed: this.projectContext.getLocalCatalog(),
            added: {}
        };
        this.projectContext = prompto.runtime.Context.newGlobalContext();
        this.projectContext.setParentContext(this.librariesContext);
        this.statuses = {};
        return delta;
    };

    registerProjectDeclarations(moduleId, declarations) {
        this.moduleId = moduleId;
        var worker = this;
        declarations.map(function (obj) {
            var decl = codeutils.parse(obj.value.body, obj.value.dialect);
            decl.register(worker.projectContext);
            // prepare for commit
            var module = obj.value.module;
            if (module) {
                // avoid sending back large objects
                delete obj.value.module.value.dependencies;
                delete obj.value.module.value.image;
            }
            worker.registerClean(obj);
        });
    };

    getDeclarationBody(content, dialect) {
        var decl = this.getDeclaration(content);
        return codeutils.unparse(this.projectContext, decl, dialect);
    };


    getDeclaration(content) {
        if (content.subType === "test")
            return this.projectContext.getRegisteredTest(content.name);
        else if (content.subType === "method") {
            var methodsMap = this.projectContext.getRegisteredDeclaration(content.name);
            if (content.proto !== null && content.proto !== undefined) {
                return methodsMap.protos[content.proto];
            } else {
                // simply return the first proto
                for (var proto in methodsMap.protos) {
                    if (methodsMap.protos.hasOwnProperty(proto))
                        return methodsMap.protos[proto];
                }
            }
        } else
            return this.projectContext.getRegisteredDeclaration(content.name);
    };

    /* dbDecl = object received from the server */
    idFromDbDecl(dbDecl) {
        if (dbDecl.type === "MethodDeclaration")
            return dbDecl.value.name + "/" + (dbDecl.value.prototype || "");
        else
            return dbDecl.value.name;
    };


    /* id = object received from the UI */
    idFromContent(content) {
        if (content.subType === "method")
            return content.name + "/" + (content.proto || "");
        else
            return content.name;
    };

    /* decl = object received from the parser */
    idFromDecl(decl) {
        return decl.name + (decl.getProto !== undefined ? "/" + (decl.getProto() || "") : "");
    };

    registerClean(obj) {
        var id = this.idFromDbDecl(obj);
        this.statuses[id] = {stuff: obj, editStatus: "CLEAN"};
    };


    registerDestroyed(id) {
        var obj_status = this.statuses[id];
        if (obj_status)
            obj_status.editStatus = "DELETED";
    };


    registerDirty(decls, parser, dialect) {
        decls.map(function (decl) {
            var decl_obj;
            var id = this.idFromDecl(decl);
            var existing = this.statuses[id];
            if (existing) {
                decl_obj = existing.stuff.value;
                var body = decl.fetchBody(parser);
                if (decl_obj.dialect !== dialect || decl_obj.body !== body) {
                    decl_obj.dialect = dialect;
                    decl_obj.body = body;
                    if (existing.editStatus !== "CREATED") // don't overwrite
                        existing.editStatus = "DIRTY";
                    if (decl.getProto !== undefined)
                        decl_obj.prototype = decl.getProto();
                    if (decl.storable !== undefined)
                        decl_obj.storable = decl.storable;
                    if (decl.symbols !== undefined)
                        decl_obj.symbols = decl.symbols.map(function (s) {
                            return s.name;
                        });
                }
            } else {
                decl_obj = {
                    name: decl.name,
                    version: "0.0.1",
                    dialect: dialect,
                    body: decl.fetchBody(parser),
                    module: {
                        type: "Module",
                        value: {
                            dbId: this.moduleId
                        }
                    }
                };
                if (decl.getProto !== undefined)
                    decl_obj.prototype = decl.getProto();
                if (decl.storable !== undefined)
                    decl_obj.storable = decl.storable;
                if (decl.symbols !== undefined)
                    decl_obj.symbols = decl.symbols.map(function (s) {
                        return s.name;
                    });
                this.statuses[id] = {
                    editStatus: "CREATED",
                    stuff: {
                        type: decl.getDeclarationType() + "Declaration",
                        value: decl_obj
                    }
                };
            }
        }, this);
    };


    registerCommitted(storedDecls) {
        var repo = this;
        storedDecls.map(function (storedDecl) {
            var id = repo.idFromDbDecl(storedDecl);
            repo.statuses[id].stuff.value.dbId = storedDecl.value.dbId;
            repo.statuses[id].editStatus = "CLEAN";
        });
    };


    prepareCommit = function () {
        var edited = [];
        for (var id in this.statuses) {
            if (this.statuses.hasOwnProperty(id) && this.statuses[id].editStatus !== "CLEAN")
                edited.push({type: "EditedStuff", value: this.statuses[id]});
        }
        if (edited.length)
            return edited;
        else
            return null;
    };


    translate = function (data, from, to) {
        return codeutils.translate(this.projectContext, data, from, to);
    };


    handleDestroyed = function (content) {
        var id = this.idFromContent(content);
        this.registerDestroyed(id);
        var obj_status = this.statuses[id];
        if (obj_status && obj_status.editStatus === "DELETED") {
            var decls = codeutils.parse(obj_status.stuff.value.body, obj_status.stuff.value.dialect);
            decls[0].unregister(this.projectContext);
            var delta = new Delta();
            delta.removed = new Codebase(decls, this.librariesContext);
            delta.filterOutDuplicates();
            return delta.getContent();
        } else
            return null;
    };


    handleSetContent = function (content, dialect, listener) {
        var decls = codeutils.parse(content, dialect, listener);
        var saved_listener = this.projectContext.problemListener;
        try {
            this.projectContext.problemListener = listener;
            decls.check(this.projectContext.newChildContext()); // don't pollute projectContext
        } finally {
            this.projectContext.problemListener = saved_listener;
        }
        this.lastSuccess = content; // assume registered content is always parsed successfully
        this.lastDialect = dialect;
    };


    handleEditContent = function (content, dialect, listener, select) {
        // analyze what has changed, we'll ignore errors but let's catch them using a temporary listener
        var previousListener = Object.create(listener);
        var old_decls = codeutils.parse(this.lastSuccess, this.lastDialect, previousListener);
        // always annotate new content
        var parser = codeutils.newParser(content, dialect, listener);
        var new_decls = parser.parse();
        // only update codebase if syntax is correct
        if (listener.problems.length === 0) {
            this.lastSuccess = content;
            this.lastDialect = dialect;
            var catalog = this.updateCodebase(old_decls, new_decls, parser, dialect, listener);
            if (select && new_decls.length === 1)
                catalog.select = new_decls[0].name;
            return catalog;
        } else
            return null;
    };


    updateCodebase = function (old_decls, new_decls, parser, dialect, listener) {
        var delta = new Delta();
        delta.removed = new Codebase(old_decls, this.projectContext, this.librariesContext);
        delta.added = new Codebase(new_decls, this.projectContext, this.librariesContext);
        var changedIdsCount = delta.filterOutDuplicates();
        var handled = false;
        // special case when changing id of a declaration, try connect to the previous version
        if (changedIdsCount === 2 && old_decls.length > 0 && new_decls.length == old_decls.length) {
            // locate new declaration, for which there is no existing status entry
            var decls_with_status = new_decls.filter(function (decl) {
                var id = this.idFromDecl(decl);
                var status = this.statuses[id] || null;
                return status == null;
            }, this);
            if (decls_with_status.length === 1) {
                var new_decl = decls_with_status[0];
                var new_id = this.idFromDecl(new_decl);
                var new_status = this.statuses[new_id];
                // locate corresponding old declaration
                var orphan_decls = old_decls.filter(function (decl) {
                    var id = this.idFromDecl(decl);
                    return new_decls.filter(function (decl) {
                        return id === this.idFromDecl(decl);
                    }, this).length === 0;
                }, this);
                if (orphan_decls.length === 1) {
                    var old_decl = orphan_decls[0];
                    var old_id = this.idFromDecl(old_decl);
                    var old_status = this.statuses[old_id];
                    // all ok, move the object
                    if (old_status && !new_status) {
                        // update statuses
                        this.statuses[new_id] = this.statuses[old_id];
                        delete this.statuses[old_id];
                        // update status obj
                        new_status = old_status;
                        if (new_status.editStatus !== "CREATED") // don't overwrite
                            new_status.editStatus = "DIRTY";
                        // update declaration obj
                        new_status.stuff.type = new_decl.getDeclarationType() + "Declaration";
                        var decl_obj = new_status.stuff.value;
                        decl_obj.name = new_decl.name;
                        decl_obj.dialect = dialect;
                        decl_obj.body = new_decl.fetchBody(parser);
                        if (new_decl.getProto !== undefined)
                            decl_obj.prototype = new_decl.getProto();
                        if (new_decl.storable !== undefined)
                            decl_obj.storable = new_decl.storable;
                        handled = true;
                    }
                }
            }
        }
        this.updateAppContext(old_decls, new_decls, listener);
        if (!handled) {
            // either no change in ids, or more than one
            // simply mark new decls as dirty, don't destroy old ones, since this can
            // be achieved safely through an explicit action in the UI
            this.registerDirty(new_decls, parser, dialect);
        }
        if (changedIdsCount !== 0) {
            delta.adjustForMovingProtos(this.projectContext);
            return delta.getContent();
        } else
            return null; // no UI update required
    };

    updateAppContext = function (old_decls, new_decls, listener) {
        old_decls.unregister(this.projectContext); // TODO: manage damage on objects referring to these
        new_decls.unregister(this.projectContext); // avoid duplicate declaration errors
        var saved_listener = this.projectContext.problemListener;
        try {
            this.projectContext.problemListener = listener;
            new_decls.register(this.projectContext);
            new_decls.check(this.projectContext.newChildContext()); // don't pollute projectContext
        } finally {
            this.projectContext.problemListener = saved_listener;
        }
    };

}