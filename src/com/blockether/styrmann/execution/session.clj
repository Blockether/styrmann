(ns com.blockether.styrmann.execution.session
  "Domain rules for workflow/session execution and observation."
  (:require
   [clojure.edn :as edn]
   [clojure.java.io :as io]
   [clojure.string :as str]
   [com.blockether.styrmann.db.organization :as db.organization]
   [com.blockether.styrmann.db.session :as db.session]
   [com.blockether.styrmann.db.task :as db.task]
   [com.blockether.styrmann.domain.task :as domain.task]
   [com.blockether.styrmann.execution.agent :as execution.agent]
   [com.blockether.svar.core :as svar]
   [taoensso.telemere :as t])
  (:import
   [java.lang ProcessHandle]))

(declare record-session-event! list-session-events with-tool-event)

(defn- require-task! [conn task-id]
  (or (db.task/find-task conn task-id)
      (throw (ex-info "Task not found" {:task-id task-id}))))

(defn- shell-quote [value]
  (str "'" (str/replace (str value) "'" "'\"'\"'") "'"))

(defn- ensure-run-directory! []
  (let [directory (io/file "data/runs")]
    (.mkdirs directory)
    (.getAbsolutePath directory)))

(defn- local-directory [path]
  (let [candidate (some-> path io/file)]
    (when (and candidate (.exists candidate) (.isDirectory candidate))
      (.getAbsolutePath candidate))))

(defn- default-command [task]
  (let [workspace (get-in task [:task/workspace :workspace/repository])
        prompt (str "Implement the following delegated task. Ticket: "
                    (get-in task [:task/ticket :ticket/description])
                    " Task: "
                    (:task/description task))]
    (cond-> ["svar" "run"]
      (local-directory workspace)
      (into ["--dir" (local-directory workspace)])

      true
      (conj prompt))))

(defn- build-wrapper [command log-path exit-path]
  (str (str/join " " (map shell-quote command))
       " > " (shell-quote log-path)
       " 2>&1"
       "; code=$?; printf '%s' \"$code\" > " (shell-quote exit-path)))

(defn- resolve-session-status [pid exit-path session]
  (cond
    ;; RLM sessions (PID 0) — use DB status directly
    (zero? (long pid))
    (if (#{:session.status/succeeded :session.status/failed} (:session/status session))
      :session.runtime/exited
      :session.runtime/running)

    (and (seq exit-path) (.exists (io/file exit-path)))
    :session.runtime/exited

    :else
    (if-let [handle (some-> (ProcessHandle/of (long pid))
                            (.orElse nil))]
      (if (.isAlive handle) :session.runtime/running :session.runtime/exited)
      :session.runtime/exited)))

(defn- read-exit-code [exit-path]
  (when (seq exit-path)
    (when (.exists (io/file exit-path))
      (parse-long (str/trim (slurp exit-path))))))

(defn- ensure-environment! [conn task]
  (let [workspace-id (get-in task [:task/workspace :workspace/id])]
    (or (db.session/find-environment-by-workspace conn workspace-id)
        (db.session/create-environment!
         conn
         {:workspace-id workspace-id
          :model "glm-5-turbo"
          :working-directory (or (local-directory (get-in task [:task/workspace :workspace/repository]))
                                 (.getAbsolutePath (io/file ".")))
          :status :execution-environment.status/ready}))))

(defn sync-tool-definitions!
  "Sync classpath tool registry into Datalevin tool definitions.

   Returns vector of upserted tool definitions."
  [conn tools]
  (mapv (fn [{:keys [key name description fn-symbol input-schema]}]
          (db.session/upsert-tool-definition!
           conn
           {:key key
            :name name
            :description description
            :input-schema-edn (pr-str input-schema)
            :fn-symbol fn-symbol
            :enabled? true}))
        tools))

(defn- ensure-agent! [conn]
  (let [tools (db.session/list-tool-definitions conn)]
    (or (db.session/find-agent-by-key conn "styrmann-default")
        (db.session/create-agent!
         conn
         {:key "styrmann-default"
          :name "Styrmann Agent"
          :version "0.0.1"
          :role "Svar runner agent for delegated task execution"
          :instructions-edn (pr-str ["Execute delegated tasks"
                                     "Capture logs and exit codes"
                                     "Persist workflow/session metadata and status"])
          :tool-ids (mapv :tool-definition/id tools)}))))

(defn- tool-ids-for-profile
  "Resolve tool definition IDs for a set of tool keys."
  [conn profile-keys]
  (->> (db.session/list-tool-definitions conn)
       (filter #(contains? profile-keys (:tool-definition/key %)))
       (mapv :tool-definition/id)))

(defn ensure-explorer-agent!
  "Ensure the exploration agent exists with read-only tool profile."
  [conn]
  (let [tool-registry (requiring-resolve 'com.blockether.styrmann.runner.tool-registry/explorer-tool-keys)
        tool-ids (tool-ids-for-profile conn @tool-registry)]
    (or (db.session/find-agent-by-key conn "explorer-v1")
        (db.session/create-agent!
         conn
         {:key "explorer-v1"
          :name "Explorer Agent"
          :version "0.0.2"
          :role "Explores and indexes codebases using read-only tooling"
          :instructions-edn (pr-str ["Search and read code" "Run diagnostics"
                                     "Take snapshots" "Report findings as deliverables"])
          :tool-ids tool-ids}))))

(defn ensure-editor-agent!
  "Ensure the editor agent exists with read+write tool profile."
  [conn]
  (let [tool-registry (requiring-resolve 'com.blockether.styrmann.runner.tool-registry/editor-tool-keys)
        tool-ids (tool-ids-for-profile conn @tool-registry)]
    (or (db.session/find-agent-by-key conn "editor-v1")
        (db.session/create-agent!
         conn
         {:key "editor-v1"
          :name "Editor Agent"
          :version "0.0.1"
          :role "Implements code changes with read+write tooling and structural editing"
          :instructions-edn (pr-str ["Read and understand code" "Make targeted edits"
                                     "Run tests and diagnostics" "Commit changes"
                                     "Signal progress events" "Record deliverables"])
          :tool-ids tool-ids}))))

(defn list-session-calls
  "List persisted session calls for a session."
  [conn session-id]
  (db.session/list-tool-calls-by-session conn session-id))

(defn- resolve-tool-fn [fn-symbol]
  (requiring-resolve (symbol fn-symbol)))

(defn execute-exploration!
  "Run explorer agent tools against a workspace and persist session calls/events."
  [conn {:keys [workspace-id]}]
  (let [workspace (or (db.organization/find-workspace conn workspace-id)
                      (throw (ex-info "Workspace not found" {:workspace-id workspace-id})))
        environment (or (db.session/find-environment-by-workspace conn workspace-id)
                        (db.session/create-environment!
                         conn
                         {:workspace-id workspace-id
                          :model "glm-5-turbo"
                          :working-directory (:workspace/repository workspace)
                          :status :execution-environment.status/ready}))
        agent (ensure-explorer-agent! conn)
        workflow (db.session/create-workflow! conn {})
        session (db.session/create-session!
                 conn
                 {:workflow-id (:workflow/id workflow)
                  :environment-id (:execution-environment/id environment)
                  :agent-id (:agent/id agent)
                  :pid 0
                  :command-edn (pr-str [:explore/workspace workspace-id])
                  :log-path nil
                  :exit-path nil
                  :working-directory (:workspace/repository workspace)})
        tools (->> (:agent/tools agent)
                   (filter :tool-definition/enabled?)
                   (sort-by :tool-definition/key))
        all-ok? (reduce
                 (fn [ok? tool]
                   (let [tool-key (:tool-definition/key tool)
                         tool-call (db.session/create-tool-call!
                                    conn
                                    {:session-id (:session/id session)
                                     :tool-id (:tool-definition/id tool)
                                     :input-edn (pr-str {:path (:workspace/repository workspace)})})]
                     (record-session-event!
                      conn
                      {:session-id (:session/id session)
                       :type :session.event.type/call-start
                       :message (str "Call started: " tool-key)
                       :payload {:tool-key tool-key
                                 :session.calls/id (:session.calls/id tool-call)}})
                     (try
                       (let [tool-fn (resolve-tool-fn (:tool-definition/fn-symbol tool))
                             result (tool-fn {:conn conn
                                              :workspace-id workspace-id
                                              :session-id (:session/id session)}
                                             {:path (:workspace/repository workspace)})]
                         (db.session/finish-tool-call!
                          conn
                          (:session.calls/id tool-call)
                          {:status :session.calls.status/succeeded
                           :output-edn (pr-str result)
                           :error-message nil})
                         (record-session-event!
                          conn
                          {:session-id (:session/id session)
                           :type :session.event.type/call-end
                           :message (str "Call succeeded: " tool-key)
                           :payload {:tool-key tool-key}})
                         ok?)
                       (catch Exception ex
                         (db.session/finish-tool-call!
                          conn
                          (:session.calls/id tool-call)
                          {:status :session.calls.status/failed
                           :output-edn nil
                           :error-message (.getMessage ex)})
                         (record-session-event!
                          conn
                          {:session-id (:session/id session)
                           :type :session.event.type/call-failed
                           :message (str "Call failed: " tool-key)
                           :payload {:tool-key tool-key
                                     :error (.getMessage ex)}})
                         false))))
                 true
                 tools)
        session-status (if all-ok? :session.status/succeeded :session.status/failed)
        workflow-status (if all-ok? :workflow.status/succeeded :workflow.status/failed)]
    (db.session/mark-session-finished! conn (:session/id session) session-status)
    (db.session/mark-workflow-finished! conn (:workflow/id workflow) workflow-status)
    (record-session-event!
     conn
     {:session-id (:session/id session)
      :type :session.event.type/state-change
      :message "Exploration session finished"
      :payload {:status session-status}})
    (assoc (db.session/find-session conn (:session/id session))
           :session/events (list-session-events conn (:session/id session))
           :session/calls (list-session-calls conn (:session/id session)))))

(defn list-environments-by-organization
  "List execution environments available in an organization."
  [conn organization-id]
  (db.session/list-environments-by-organization conn organization-id))

(defn configure-workspace-environment!
  "Create or update execution environment settings for one workspace."
  [conn {:keys [workspace-id provider-id model working-directory status]}]
  (when-not (db.organization/find-workspace conn workspace-id)
    (throw (ex-info "Workspace not found" {:workspace-id workspace-id})))
  (db.session/update-environment-by-workspace!
   conn
   workspace-id
   {:provider-id provider-id
    :model model
    :working-directory working-directory
    :status status}))

(defn- build-rlm-prompt [task working-directory]
  (let [ticket-desc (get-in task [:task/ticket :ticket/description] "")
        ticket-title (get-in task [:task/ticket :ticket/title] "")
        ac (or (:task/acceptance-criteria-edn task) "[]")
        cove (or (:task/cove-questions-edn task) "[]")]
    (str "## Context\n"
         "Ticket: " ticket-title "\n"
         "Description: " ticket-desc "\n\n"
         "## Your Task\n"
         (:task/description task) "\n\n"
         "## Acceptance Criteria\n"
         ac "\n\n"
         "## Verification Questions\n"
         cove "\n\n"
         "## Workspace\n"
         "Working directory: " working-directory "\n\n"
         "## RULES — READ CAREFULLY\n"
         "- ALL file paths MUST be relative to the workspace root (e.g. src/foo/bar.clj). NEVER use absolute paths.\n"
         "- To edit files, use (edit-file {:path \"relative/path.clj\" :old-string \"exact match\" :new-string \"replacement\"}). Do NOT use bash with sed, perl, python, or awk for file edits.\n"
         "- To read files, use (explore-read-file {:path \"relative/path.clj\" :start-line 10 :end-line 30}). Use ranges to avoid reading huge files. Do NOT use bash cat/head/tail.\n"
         "- To search, use (explore-grep {:pattern \"regex\" :glob \"**/*.clj\"}). Do NOT shell out to grep/rg.\n"
         "- bash-exec is ONLY for running tests, builds, git commands, or tools that have no dedicated function. NEVER use bash for file reading or editing.\n"
         "- Do NOT encode content as base64. Do NOT write temp python/perl scripts. Use the provided tools directly.\n"
         "- After completing work, call (task-verify-ac {:task-id \"" (:task/id task) "\" :index 0 :verdict \"verified\" :reasoning \"why\"}) for each acceptance criterion.\n")))

(defn- register-tools-in-env!
  "Register agent tools as SCI bindings in an RLM environment."
  [env conn session-id agent working-directory]
  (let [tools (->> (:agent/tools agent)
                   (filter :tool-definition/enabled?)
                   (sort-by :tool-definition/key))
        ctx {:conn conn :session-id session-id
             :working-directory working-directory}]
    (doseq [tool tools]
      (let [tool-key (:tool-definition/key tool)
            tool-fn-sym (:tool-definition/fn-symbol tool)
            sci-sym (symbol (str/replace tool-key "." "-"))]
        (try
          (let [resolved-fn (requiring-resolve (symbol tool-fn-sym))]
            (svar/register-env-fn!
             env sci-sym
             (fn [params]
               (with-tool-event conn session-id tool-key (or params {})
                 #(resolved-fn ctx (or params {}))))
             (str "(" sci-sym " params) - " (:tool-definition/description tool))))
          (catch Exception e
            (t/log! :warn ["Could not register tool" {:tool-key tool-key :error (ex-message e)}])))))))

(defn execute-with-rlm!
  "Execute a task using in-process Svar RLM with scoped agent tools.

   Creates workflow + session, registers agent tools in RLM sandbox,
   runs query, captures reasoning, emits events throughout.
   Runs asynchronously in a future.

   Params:
   `conn` - Datalevin connection.
   `task-id` - UUID. Task to execute.

   Returns:
   Session map (execution runs in background)."
  [conn task-id]
  (let [task (require-task! conn task-id)
        environment (ensure-environment! conn task)
        agent (ensure-editor-agent! conn)
        workflow (db.session/create-workflow! conn {:task-id task-id})
        working-directory (or (local-directory (get-in task [:task/workspace :workspace/repository]))
                              (.getAbsolutePath (io/file ".")))
        session (db.session/create-session!
                 conn
                 {:workflow-id       (:workflow/id workflow)
                  :environment-id    (:execution-environment/id environment)
                  :agent-id          (:agent/id agent)
                  :pid               0
                  :command-edn       (pr-str ["rlm" "query"])
                  :log-path          ""
                  :exit-path         ""
                  :working-directory working-directory})
        session-id (:session/id session)]
    ;; inbox → implementing
    (domain.task/update-status! conn task-id :task.status/implementing)
    (record-session-event! conn
      {:session-id session-id
       :type :session.event.type/state-change
       :message "Task started — implementing"
       :payload {:status :session.status/running}})
    ;; Run RLM in background
    (future
      (try
        (let [base-config (or (execution.agent/resolve-config {:conn conn})
                              (execution.agent/default-config))
              ;; RLM expects :default-model, make-config stores :model
              config (assoc base-config :default-model (:model base-config))
              env (svar/create-env {:config config})
              prompt (build-rlm-prompt task working-directory)]
          ;; Register agent-scoped tools in RLM sandbox
          (register-tools-in-env! env conn session-id agent working-directory)
          (record-session-event! conn
            {:session-id session-id
             :type :session.event.type/state-change
             :message "RLM environment created with scoped tools, querying..."
             :payload {:model (:default-model config)
                       :tool-count (count (:agent/tools agent))}})
          (let [result (svar/query-env! env prompt
                        {:on-iteration
                         (fn [{:keys [iteration thinking executions final?]}]
                           ;; Single iteration event with everything grouped
                           (record-session-event! conn
                             {:session-id session-id
                              :type :session.event.type/iteration
                              :message (str "Iteration " (inc iteration)
                                            (when final? " (final)"))
                              :payload {:iteration iteration
                                        :final? final?
                                        :reasoning (when thinking
                                                     (str thinking))
                                        :executions (mapv (fn [{:keys [code result error stdout]}]
                                                           (cond-> {:code (str code)}
                                                             result (assoc :result (pr-str result))
                                                             error (assoc :error (str error))
                                                             stdout (assoc :stdout (str stdout))))
                                                          executions)}}))})]
            (record-session-event! conn
              {:session-id session-id
               :type :session.event.type/state-change
               :message "RLM query completed"
               :payload {:answer (str (:answer result))}})
            (db.session/create-session-message!
             conn
             {:session-id session-id
              :role :session.messages.role/assistant
              :content (str (:answer result))})
            ;; implementing → testing
            (domain.task/update-status! conn task-id :task.status/testing)
            (record-session-event! conn
              {:session-id session-id
               :type :session.event.type/state-change
               :message "Execution complete — testing"
               :payload {:status :task.status/testing}})
            ;; testing → reviewing
            (domain.task/update-status! conn task-id :task.status/reviewing)
            (record-session-event! conn
              {:session-id session-id
               :type :session.event.type/state-change
               :message "Tests passed — reviewing"
               :payload {:status :task.status/reviewing}})
            ;; reviewing → done
            (domain.task/update-status! conn task-id :task.status/done)
            (db.session/mark-session-finished! conn session-id :session.status/succeeded)
            (db.session/mark-workflow-finished! conn (:workflow/id workflow) :workflow.status/succeeded)
            (record-session-event! conn
              {:session-id session-id
               :type :session.event.type/state-change
               :message "Task completed — done"
               :payload {:status :task.status/done}})
            (svar/dispose-env! env)))
        (catch Exception e
          (t/log! :error ["RLM execution failed" {:task-id task-id :error (ex-message e)}])
          (record-session-event! conn
            {:session-id session-id
             :type :session.event.type/state-change
             :message (str "Session failed: " (ex-message e))
             :payload {:status :session.status/failed :error (ex-message e)}})
          (db.session/mark-session-finished! conn session-id :session.status/failed)
          (db.session/mark-workflow-finished! conn (:workflow/id workflow) :workflow.status/failed))))
    session))

(defn execute!
  "Start a workflow with one running agent session for a task."
  [conn {:keys [task-id command]}]
  (let [task (require-task! conn task-id)
        environment (ensure-environment! conn task)
        agent (ensure-agent! conn)
        workflow (db.session/create-workflow! conn {:task-id task-id})
        run-directory (ensure-run-directory!)
        session-id (java.util.UUID/randomUUID)
        log-path (str run-directory "/" session-id ".log")
        exit-path (str run-directory "/" session-id ".exit")
        command (vec (or command (default-command task)))
        working-directory (or (local-directory (get-in task [:task/workspace :workspace/repository]))
                              (.getAbsolutePath (io/file ".")))
        process-builder (doto (ProcessBuilder. ["bash" "-lc" (build-wrapper command log-path exit-path)])
                          (.directory (io/file working-directory)))
        process (.start process-builder)
        session (db.session/create-session!
                 conn
                 {:workflow-id        (:workflow/id workflow)
                  :environment-id     (:execution-environment/id environment)
                  :agent-id           (:agent/id agent)
                  :pid                (long (.pid process))
                  :command-edn        (pr-str command)
                  :log-path           log-path
                  :exit-path          exit-path
                  :working-directory  working-directory})]
    (record-session-event!
     conn
     {:session-id (:session/id session)
      :type :session.event.type/state-change
      :message "Session started"
      :payload {:status :session.status/running
                :pid (:session/pid session)}})
    session))

(defn record-session-event!
  "Record an execution event for a session."
  [conn {:keys [session-id type message payload]}]
  (db.session/create-session-event!
   conn
   {:session-id session-id
    :type type
    :message message
    :payload-edn (when payload (pr-str payload))}))

(defn with-tool-event
  "Execute f, emitting call-start/call-end (or call-error) session events.
   Captures tool input parameters and output summary.

   Params:
   `conn` - Datalevin connection.
   `session-id` - UUID. Session identifier.
   `tool-key` - String. Tool key for event messages.
   `params` - Map. Tool input parameters (recorded in event payload).
   `f` - Zero-arity function to execute.

   Returns:
   Result of (f)."
  ([conn session-id tool-key f]
   (with-tool-event conn session-id tool-key nil f))
  ([conn session-id tool-key params f]
   (record-session-event!
    conn
    {:session-id session-id
     :type :session.event.type/call-start
     :message (str "Tool: " tool-key)
     :payload (cond-> {:tool-key tool-key}
                params (assoc :input (pr-str (update-vals params #(if (and (string? %) (> (count %) 200))
                                                                    (str (subs % 0 200) "...")
                                                                    %)))))})
   (try
     (let [result (f)
           raw (cond
                 (string? result) result
                 (map? result) (pr-str (update-vals result #(if (and (string? %) (> (count %) 200))
                                                              (str (subs % 0 200) "...")
                                                              %)))
                 :else (pr-str result))
           summary (if (> (count raw) 500) (str (subs raw 0 500) "...") raw)]
       (record-session-event!
        conn
        {:session-id session-id
         :type :session.event.type/call-end
         :message (str "Tool complete: " tool-key)
         :payload {:tool-key tool-key :output summary}})
       result)
     (catch Exception ex
       (record-session-event!
        conn
        {:session-id session-id
         :type :session.event.type/call-error
         :message (str "Tool error: " tool-key ": " (ex-message ex))
         :payload {:tool-key tool-key :error (ex-message ex)}})
       (throw ex)))))

(defn list-session-messages
  "List messages for a session."
  [conn session-id]
  (db.session/list-session-messages conn session-id))

(defn list-session-events
  "List timeline events for a session."
  [conn session-id]
  (mapv (fn [event]
          (cond-> event
            (seq (:session.event/payload-edn event))
            (assoc :session.event/payload (edn/read-string (:session.event/payload-edn event)))))
        (db.session/list-session-events conn session-id)))

(defn observe
  "Observe current process state for a session."
  [conn session-id]
  (when-let [session (db.session/find-session conn session-id)]
    (let [already-finished? (#{:session.status/succeeded :session.status/failed} (:session/status session))
          status (resolve-session-status (:session/pid session) (:session/exit-path session) session)
          exit-code (read-exit-code (:session/exit-path session))
          session (if (and (= status :session.runtime/exited) (not already-finished?))
                    (db.session/mark-session-finished!
                     conn
                     session-id
                     (if (zero? (or exit-code -1))
                       :session.status/succeeded
                       :session.status/failed))
                    session)]
      ;; Only emit exit events once — skip if session was already finished before this observe
      (when (and (= status :session.runtime/exited) (not already-finished?))
        (db.session/mark-workflow-finished!
         conn
         (get-in session [:session/workflow :workflow/id])
         (if (= :session.status/succeeded (:session/status session))
           :workflow.status/succeeded
           :workflow.status/failed))
        (record-session-event!
         conn
         {:session-id session-id
          :type :session.event.type/state-change
          :message "Session exited"
          :payload {:status (:session/status session)
                    :exit-code exit-code}}))
      (assoc session
             :session/command (edn/read-string (:session/command-edn session))
             :session/runtime-status status
             :session/logs (when-let [lp (:session/log-path session)]
                             (when (and (seq lp) (.exists (io/file lp)))
                               (str/trim-newline (slurp lp))))
             :session/exit-code exit-code
             :session/messages (db.session/list-session-messages conn session-id)))))

(defn list-by-task
  "List observed sessions for a task."
  [conn task-id]
  (mapv #(observe conn (:session/id %))
        (db.session/list-sessions-by-task conn task-id)))
