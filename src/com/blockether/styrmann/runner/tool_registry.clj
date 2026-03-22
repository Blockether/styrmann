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
  ;; Filesystem tools
  (register-tool!
   {:key "explore.read-file"
    :name "Read File"
    :description "Read file contents. Use :start-line and :end-line (1-based) to read a range instead of the whole file."
    :fn-symbol "com.blockether.styrmann.execution.tools.filesystem/read-file"
    :input-schema {:type :map
                   :required [:path]}})
  (register-tool!
   {:key "explore.grep"
    :name "Grep"
    :description "Search file contents using ripgrep patterns"
    :fn-symbol "com.blockether.styrmann.execution.tools.filesystem/grep"
    :input-schema {:type :map
                   :required [:pattern]}})
  (register-tool!
   {:key "explore.glob-files"
    :name "Glob Files"
    :description "Find files matching a glob pattern"
    :fn-symbol "com.blockether.styrmann.execution.tools.filesystem/glob-files"
    :input-schema {:type :map
                   :required [:pattern]}})
  (register-tool!
   {:key "edit.write-file"
    :name "Write File"
    :description "Write content to a file (scoped to workspace)"
    :fn-symbol "com.blockether.styrmann.execution.tools.filesystem/write-file"
    :input-schema {:type :map
                   :required [:path :content]}})
  (register-tool!
   {:key "edit.edit-file"
    :name "Edit File"
    :description "Replace a string in a file (scoped to workspace)"
    :fn-symbol "com.blockether.styrmann.execution.tools.filesystem/edit-file"
    :input-schema {:type :map
                   :required [:path :old-string :new-string]}})
  ;; Spel tools
  (register-tool!
   {:key "explore.spel-snapshot"
    :name "Spel Snapshot"
    :description "Take a Spel DOM snapshot of a URL with optional selector"
    :fn-symbol "com.blockether.styrmann.execution.tools.spel-tools/spel-snapshot"
    :input-schema {:type :map
                   :required [:url]}})
  (register-tool!
   {:key "explore.markdownify"
    :name "Markdownify"
    :description "Convert a URL to markdown text"
    :fn-symbol "com.blockether.styrmann.execution.tools.spel-tools/markdownify"
    :input-schema {:type :map
                   :required [:url]}})
  ;; System tools
  (register-tool!
   {:key "system.signal-event"
    :name "Signal Event"
    :description "Emit an event to the Styrmann execution event system"
    :fn-symbol "com.blockether.styrmann.execution.tools.system/signal-event"
    :input-schema {:type :map
                   :required [:type :message]}})
  (register-tool!
   {:key "system.record-deliverable"
    :name "Record Deliverable"
    :description "Record a deliverable (finding, analysis, diff) on a task"
    :fn-symbol "com.blockether.styrmann.execution.tools.system/record-deliverable"
    :input-schema {:type :map
                   :required [:task-id :title]}})
  (register-tool!
   {:key "task.update-status"
    :name "Update Task Status"
    :description "Update a task's lifecycle status"
    :fn-symbol "com.blockether.styrmann.execution.tools.system/update-task-status"
    :input-schema {:type :map
                   :required [:task-id :status]}})
  (register-tool!
   {:key "task.verify-ac"
    :name "Verify Acceptance Criterion"
    :description "Mark an acceptance criterion as verified, failed, or skipped with reasoning"
    :fn-symbol "com.blockether.styrmann.execution.tools.system/verify-acceptance-criterion"
    :input-schema {:type :map
                   :required [:task-id :index :verdict :reasoning]}})
  ;; Structural edit tools
  (register-tool!
   {:key "edit.clojure-lsp-rename"
    :name "Clojure LSP Rename"
    :description "Structural rename of a symbol via clojure-lsp"
    :fn-symbol "com.blockether.styrmann.execution.tools.structural-edit/clojure-lsp-rename"
    :input-schema {:type :map
                   :required [:path :line :column :new-name]}})
  (register-tool!
   {:key "edit.clojure-lsp-clean-ns"
    :name "Clojure LSP Clean NS"
    :description "Clean namespace declarations via clojure-lsp"
    :fn-symbol "com.blockether.styrmann.execution.tools.structural-edit/clojure-lsp-clean-ns"
    :input-schema {:type :map
                   :required [:path]}})
  (register-tool!
   {:key "edit.bash"
    :name "Bash Execute"
    :description "Execute a shell command in the workspace directory (sandboxed)"
    :fn-symbol "com.blockether.styrmann.execution.tools.structural-edit/bash-exec"
    :input-schema {:type :map
                   :required [:command]}})
  (register-tool!
   {:key "git.commit"
    :name "Git Commit"
    :description "Create a git commit in the workspace repository"
    :fn-symbol "com.blockether.styrmann.execution.tools.structural-edit/bash-exec"
    :input-schema {:type :map
                   :required [:command]}})
  (register-tool!
   {:key "edit.create-ns-file"
    :name "Create Namespace File"
    :description "Create a new Clojure file with a namespace declaration from structured data. No string escaping needed. Pass :ns-name as a symbol, :requires as vectors of [ns :as alias] or [ns :refer [sym]], :imports as vectors of [package Class]. PREFER this over write-file for creating new Clojure files."
    :fn-symbol "com.blockether.styrmann.execution.tools.structural-edit/create-ns-file"
    :input-schema {:type :map
                   :required [:path :ns-name]}})
  (register-tool!
   {:key "edit.append-form"
    :name "Append Form"
    :description "Append a quoted Clojure form to the end of a file. The form is actual Clojure data (not a string), pretty-printed and appended. Use with create-ns-file to build files incrementally. Example: (edit-append-form {:path \"test.clj\" :form '(defn greet [name] (str \"Hello \" name))})"
    :fn-symbol "com.blockether.styrmann.execution.tools.structural-edit/append-form"
    :input-schema {:type :map
                   :required [:path :form]}})
  (list-tools))

;; -- Agent profiles -----------------------------------------------------------

(def explorer-tool-keys
  "Tool keys available to the explorer agent (read-only)."
  #{"explore.read-file" "explore.grep" "explore.glob-files"
    "explore.clojure-lsp-diagnostics" "explore.namespace-map"
    "explore.spel-snapshot" "explore.markdownify"
    "system.signal-event" "system.record-deliverable"
    "ticket.find" "task.list-by-ticket"})

(def editor-tool-keys
  "Tool keys available to the editor agent (read + write)."
  (set/union explorer-tool-keys
             #{"edit.write-file" "edit.edit-file"
               "edit.create-ns-file" "edit.append-form"
               "edit.clojure-lsp-rename" "edit.clojure-lsp-clean-ns"
               "edit.bash" "git.commit" "git.repo.summary"
               "task.update-status" "task.verify-ac" "system.record-deliverable"}))

(defn tools-for-profile
  "Return tool definitions matching a profile's tool keys.

   Params:
   `profile-keys` - Set of tool key strings.

   Returns:
   Vector of matching tool definitions."
  [profile-keys]
  (->> (list-tools)
       (filter #(contains? profile-keys (:key %)))
       vec))
