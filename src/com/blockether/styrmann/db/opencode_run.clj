(ns com.blockether.styrmann.db.opencode-run
  "Datalevin persistence for OpenCode runs."
  (:require
   [datalevin.core :as d])
  (:import
   [java.util UUID]))

(def ^:private run-pull
  [:opencode-run/id
   :opencode-run/pid
   :opencode-run/command-edn
   :opencode-run/log-path
   :opencode-run/exit-path
   :opencode-run/working-directory
   :opencode-run/created-at
   {:opencode-run/task [:task/id :task/description :task/status {:task/workspace [:workspace/id :workspace/name :workspace/repository]}]}])

(defn find-run
  "Fetch an OpenCode run by its UUID.

   Params:
   `conn` - Datalevin connection.
   `run-id` - UUID. Run identifier.

   Returns:
   Run map or nil."
  [conn run-id]
  (d/pull (d/db conn) run-pull [:opencode-run/id run-id]))

(defn list-runs-by-task
  "List runs for a task.

   Params:
   `conn` - Datalevin connection.
   `task-id` - UUID. Task identifier.

   Returns:
   Vector of run maps."
  [conn task-id]
  (->> (d/q '[:find ?run-id
              :in $ ?task-id
              :where
              [?task :task/id ?task-id]
              [?run :opencode-run/task ?task]
              [?run :opencode-run/id ?run-id]]
            (d/db conn)
            task-id)
       (map first)
       (map #(find-run conn %))
       (sort-by :opencode-run/created-at #(compare %2 %1))
       vec))

(defn create-run!
  "Persist an OpenCode run mapping.

   Params:
   `conn` - Datalevin connection.
   `attrs` - Map with task ref, pid, command, and log metadata.

   Returns:
   Persisted run map."
  [conn {:keys [task-id pid command-edn log-path exit-path working-directory]}]
  (let [run-id (UUID/randomUUID)]
    (d/transact! conn [{:opencode-run/id                run-id
                        :opencode-run/task              [:task/id task-id]
                        :opencode-run/pid               pid
                        :opencode-run/command-edn       command-edn
                        :opencode-run/log-path          log-path
                        :opencode-run/exit-path         exit-path
                        :opencode-run/working-directory working-directory
                        :opencode-run/created-at        (java.util.Date.)}])
    (find-run conn run-id)))
