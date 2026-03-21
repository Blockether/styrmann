(ns com.blockether.styrmann.runner.tool-registry
  "In-memory classpath tool registry for runner integration."
  (:require
   [clojure.set :as set]))

(defonce ^:private !registry (atom {}))

(defn register-tool!
  "Register or replace a tool definition in the runtime registry.

   Required keys:
   - :key
   - :name
   - :description
   - :fn-symbol
   - :input-schema"
  [{:keys [key name description fn-symbol input-schema] :as tool}]
  (when-not (and key name description fn-symbol input-schema)
    (throw (ex-info "Tool definition is missing required keys"
                    {:missing (set/difference #{:key :name :description :fn-symbol :input-schema}
                                              (set (keys tool)))})))
  (swap! !registry assoc key tool)
  tool)

(defn unregister-tool!
  "Remove a tool definition by key."
  [tool-key]
  (swap! !registry dissoc tool-key)
  nil)

(defn list-tools
  "Return all registered tool definitions sorted by key."
  []
  (->> @!registry
       vals
       (sort-by :key)
       vec))

(defn find-tool
  "Return one tool definition by key or nil."
  [tool-key]
  (get @!registry tool-key))

(defn register-default-tools!
  "Register built-in Styrmann tools.

   These are metadata registrations; function vars can be supplied by classpath extensions."
  []
  (register-tool!
   {:key "ticket.find"
    :name "Find Ticket"
    :description "Find ticket details by id"
    :fn-symbol "com.blockether.styrmann.runner.tools.ticket/find-ticket"
    :input-schema {:type :map
                   :required [:ticket-id]}})
  (register-tool!
   {:key "task.list-by-ticket"
    :name "List Tasks by Ticket"
    :description "List tasks for a ticket"
    :fn-symbol "com.blockether.styrmann.runner.tools.task/list-by-ticket"
    :input-schema {:type :map
                   :required [:ticket-id]}})
  (register-tool!
   {:key "git.repo.summary"
    :name "Git Repo Summary"
    :description "Read git repository metadata and latest commit summary"
    :fn-symbol "com.blockether.styrmann.runner.tools.git/repo-summary"
    :input-schema {:type :map
                   :required [:workspace-id]}})
  (register-tool!
   {:key "explore.clojure-lsp-diagnostics"
    :name "Clojure LSP Diagnostics"
    :description "Run clojure-lsp diagnostics to validate indexing/parsing for a codebase"
    :fn-symbol "com.blockether.styrmann.execution.tools.explore/clojure-lsp-diagnostics"
    :input-schema {:type :map
                   :required [:path]}})
  (register-tool!
   {:key "explore.namespace-map"
    :name "Namespace Map"
    :description "Collect Clojure namespace declarations under a path"
    :fn-symbol "com.blockether.styrmann.execution.tools.explore/namespace-map"
    :input-schema {:type :map
                   :required [:path]}})
  (list-tools))
