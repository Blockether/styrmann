(ns com.blockether.styrmann.execution.session
  "Domain rules for workflow/session execution and observation."
  (:require
   [clojure.edn :as edn]
   [clojure.java.io :as io]
   [clojure.string :as str]
   [com.blockether.styrmann.db.organization :as db.organization]
   [com.blockether.styrmann.db.session :as db.session]
   [com.blockether.styrmann.db.task :as db.task])
  (:import
   [java.lang ProcessHandle]))

(declare record-session-event! list-session-events)

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

(defn- resolve-session-status [pid exit-path]
  (cond
    (.exists (io/file exit-path))
    :session.runtime/exited

    :else
    (if-let [handle (some-> (ProcessHandle/of (long pid))
                            (.orElse nil))]
      (if (.isAlive handle) :session.runtime/running :session.runtime/exited)
      :session.runtime/exited)))

(defn- read-exit-code [exit-path]
  (when (.exists (io/file exit-path))
    (parse-long (str/trim (slurp exit-path)))))

(defn- ensure-environment! [conn task]
  (let [workspace-id (get-in task [:task/workspace :workspace/id])]
    (or (db.session/find-environment-by-workspace conn workspace-id)
        (db.session/create-environment!
         conn
         {:workspace-id workspace-id
          :model "gpt-4o-mini"
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

(defn ensure-explorer-agent!
  "Ensure the initial exploration agent exists and is bound to exploration tools."
  [conn]
  (let [tool-ids (->> (db.session/list-tool-definitions conn)
                      (filter #(str/starts-with? (:tool-definition/key %) "explore."))
                      (mapv :tool-definition/id))]
    (or (db.session/find-agent-by-key conn "explorer-v1")
        (db.session/create-agent!
         conn
         {:key "explorer-v1"
          :name "Explorer Agent"
          :version "0.0.1"
          :role "Explores and indexes Clojure codebases using clojure-lsp-backed tooling"
          :instructions-edn (pr-str ["Run clojure-lsp diagnostics for target codebase"
                                     "Build namespace inventory and structural map"
                                     "Report indexing readiness and blockers"])
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
                          :model "gpt-4o-mini"
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
    (let [status (resolve-session-status (:session/pid session) (:session/exit-path session))
          exit-code (read-exit-code (:session/exit-path session))
          session (if (= status :session.runtime/exited)
                    (db.session/mark-session-finished!
                     conn
                     session-id
                     (if (zero? (or exit-code -1))
                       :session.status/succeeded
                       :session.status/failed))
                    session)]
      (when (= status :session.runtime/exited)
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
             :session/logs (when (.exists (io/file (:session/log-path session)))
                             (str/trim-newline (slurp (:session/log-path session))))
             :session/exit-code exit-code))))

(defn list-by-task
  "List observed sessions for a task."
  [conn task-id]
  (mapv #(observe conn (:session/id %))
        (db.session/list-sessions-by-task conn task-id)))
