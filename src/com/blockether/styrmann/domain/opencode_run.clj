(ns com.blockether.styrmann.domain.opencode-run
  "Domain rules for external OpenCode process execution and observation."
  (:require
   [clojure.edn :as edn]
   [clojure.java.io :as io]
   [clojure.string :as str]
   [com.blockether.styrmann.db.opencode-run :as db.opencode-run]
   [com.blockether.styrmann.db.task :as db.task])
  (:import
   [java.lang ProcessHandle]))

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
    (cond-> ["opencode" "run"]
      (local-directory workspace)
      (into ["--dir" (local-directory workspace)])

      true
      (conj prompt))))

(defn- build-wrapper [command log-path exit-path]
  (str (str/join " " (map shell-quote command))
       " > " (shell-quote log-path)
       " 2>&1"
       "; code=$?; printf '%s' \"$code\" > " (shell-quote exit-path)))

(defn- run-status [pid exit-path]
  (cond
    (.exists (io/file exit-path))
    :run.status/exited

    :else
    (if-let [handle (some-> (ProcessHandle/of (long pid))
                            (.orElse nil))]
      (if (.isAlive handle) :run.status/running :run.status/exited)
      :run.status/exited)))

(defn execute!
  "Start an external run for a task and persist the pid mapping.

   Params:
   `conn` - Datalevin connection.
   `attrs` - Map with `:task-id` and optional `:command` vector.

   Returns:
   Persisted run map."
  [conn {:keys [task-id command]}]
  (let [task (require-task! conn task-id)
        run-directory (ensure-run-directory!)
        run-id (java.util.UUID/randomUUID)
        log-path (str run-directory "/" run-id ".log")
        exit-path (str run-directory "/" run-id ".exit")
        command (vec (or command (default-command task)))
        working-directory (or (local-directory (get-in task [:task/workspace :workspace/repository]))
                              (.getAbsolutePath (io/file ".")))
        process-builder (doto (ProcessBuilder. ["bash" "-lc" (build-wrapper command log-path exit-path)])
                          (.directory (io/file working-directory)))
        process (.start process-builder)]
    (db.opencode-run/create-run!
     conn
     {:task-id           task-id
      :pid               (long (.pid process))
      :command-edn       (pr-str command)
      :log-path          log-path
      :exit-path         exit-path
      :working-directory working-directory})))

(defn observe
  "Observe current external process state for a run.

   Params:
   `conn` - Datalevin connection.
   `run-id` - UUID. Run identifier.

   Returns:
   Run map enriched with derived status, logs, and exit code when available."
  [conn run-id]
  (when-let [run (db.opencode-run/find-run conn run-id)]
    (assoc run
           :opencode-run/command (edn/read-string (:opencode-run/command-edn run))
           :run/status (run-status (:opencode-run/pid run) (:opencode-run/exit-path run))
           :run/logs (when (.exists (io/file (:opencode-run/log-path run)))
                       (str/trim-newline (slurp (:opencode-run/log-path run))))
           :run/exit-code (when (.exists (io/file (:opencode-run/exit-path run)))
                            (parse-long (str/trim (slurp (:opencode-run/exit-path run))))))))

(defn list-by-task
  "List observed runs for a task.

   Params:
   `conn` - Datalevin connection.
   `task-id` - UUID. Task identifier.

   Returns:
   Vector of observed run maps."
  [conn task-id]
  (mapv #(observe conn (:opencode-run/id %))
        (db.opencode-run/list-runs-by-task conn task-id)))
