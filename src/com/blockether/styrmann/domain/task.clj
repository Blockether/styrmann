(ns com.blockether.styrmann.domain.task
  "Domain rules for AI tasks and notifications."
  (:require
   [clojure.string :as str]
   [com.blockether.styrmann.db.organization :as db.organization]
   [com.blockether.styrmann.db.task :as db.task]
   [com.blockether.styrmann.db.ticket :as db.ticket])
  (:import
   [java.util UUID]))

(def ^:private allowed-statuses
  #{:task.status/inbox
    :task.status/implementing
    :task.status/testing
    :task.status/reviewing
    :task.status/done})

(def ^:private allowed-transitions
  {:task.status/inbox        #{:task.status/implementing}
   :task.status/implementing #{:task.status/testing}
   :task.status/testing      #{:task.status/reviewing}
   :task.status/reviewing    #{:task.status/done}
   :task.status/done         #{}})

(defn- require-text! [value message]
  (let [trimmed (some-> value str/trim)]
    (when (str/blank? trimmed)
      (throw (ex-info message {:value value})))
    trimmed))

(defn create!
  "Create an AI task bound to a ticket and workspace.

   Params:
   `conn` - Datalevin connection.
   `attrs` - Map with `:ticket-id`, `:workspace-id`, `:description`, and optional
             `:acceptance-criteria-edn`, `:cove-questions-edn`, `:depends-on`.

   Returns:
   Persisted task map."
  [conn {:keys [ticket-id workspace-id description acceptance-criteria-edn cove-questions-edn depends-on]}]
  (let [ticket (db.ticket/find-ticket conn ticket-id)
        workspace (db.organization/find-workspace conn workspace-id)]
    (when-not ticket
      (throw (ex-info "Ticket not found" {:ticket-id ticket-id})))
    (when-not workspace
      (throw (ex-info "Workspace not found" {:workspace-id workspace-id})))
    (when-not (= (get-in ticket [:ticket/organization :organization/id])
                 (get-in workspace [:workspace/organization :organization/id]))
      (throw (ex-info "Workspace must belong to the same organization as the ticket"
                      {:ticket-id ticket-id :workspace-id workspace-id})))
    (db.task/create-task!
     conn
     {:ticket-id                ticket-id
      :workspace-id             workspace-id
      :description              (require-text! description "Task description is required")
      :acceptance-criteria-edn  acceptance-criteria-edn
      :cove-questions-edn       cove-questions-edn
      :depends-on               depends-on})))

(defn list-by-ticket
  "List tasks for a ticket.

   Params:
   `conn` - Datalevin connection.
   `ticket-id` - UUID. Ticket identifier.

   Returns:
   Vector of task maps."
  [conn ticket-id]
  (db.task/list-tasks-by-ticket conn ticket-id))

(defn list-by-workspace
  "List tasks for a workspace.

   Params:
   `conn` - Datalevin connection.
   `workspace-id` - UUID. Workspace identifier.

   Returns:
   Vector of task maps."
  [conn workspace-id]
  (db.task/list-tasks-by-workspace conn workspace-id))

(defn- find-cycle
  "DFS cycle detection returning the cycle path as indices, or nil."
  [specs]
  (let [n       (count specs)
        visited (volatile! #{})
        path    (volatile! [])
        in-path (volatile! #{})]
    (letfn [(dfs [i]
              (cond
                (@in-path i)
                (let [p     @path
                      start (.indexOf ^java.util.List (vec p) i)]
                  (conj (subvec (vec p) start) i))

                (@visited i) nil

                :else
                (do
                  (vswap! path conj i)
                  (vswap! in-path conj i)
                  (let [result (some dfs (get-in specs [i :depends-on-indices] []))]
                    (vswap! path (fn [v] (subvec v 0 (max 0 (dec (count v))))))
                    (vswap! in-path disj i)
                    (vswap! visited conj i)
                    result))))]
      (some dfs (range n)))))

(defn validate-graph
  "Validate a task graph spec without side effects.

   Checks:
   1. Every spec has a non-blank description.
   2. Every depends-on index is within bounds.
   3. No dependency cycles exist.
   4. Every workspace-id is a UUID.

   Params:
   `specs` - Vector of task spec maps (same shape as `create-graph!`).

   Returns:
   `{:valid true}` or `{:valid false :errors [...]}` where each error is a map
   with `:type`, `:message`, and contextual keys for programmatic retry."
  [specs]
  (let [n      (count specs)
        errors (transient [])]
    ;; 1. Blank descriptions
    (doseq [[i {:keys [description]}] (map-indexed vector specs)]
      (when (str/blank? description)
        (conj! errors {:type    :blank-description
                       :index   i
                       :message (str "Task at index " i " has a blank description.")})))
    ;; 2. Out-of-bounds indices
    (doseq [[i {:keys [depends-on-indices]}] (map-indexed vector specs)]
      (doseq [dep-i (or depends-on-indices [])]
        (when (or (neg? dep-i) (>= dep-i n))
          (conj! errors {:type    :index-out-of-bounds
                         :index   i
                         :dep-index dep-i
                         :max-index (dec n)
                         :message (str "Task " i " (\"" (get-in specs [i :description]) "\")"
                                       " depends on index " dep-i
                                       " but valid range is 0.." (dec n) ".")}))
        (when (= dep-i i)
          (conj! errors {:type    :self-dependency
                         :index   i
                         :message (str "Task " i " (\"" (get-in specs [i :description]) "\")"
                                       " depends on itself.")}))))
    ;; 3. Cycles
    (when-let [cycle-path (find-cycle specs)]
      (let [descriptions (mapv #(get-in specs [% :description] (str "index " %)) cycle-path)]
        (conj! errors {:type         :cycle
                       :indices      cycle-path
                       :descriptions descriptions
                       :message      (str "Circular dependency: "
                                          (str/join " \u2192 " descriptions) ".")})))
    ;; 4. Missing workspace-id
    (doseq [[i {:keys [workspace-id]}] (map-indexed vector specs)]
      (when-not (uuid? workspace-id)
        (conj! errors {:type    :invalid-workspace
                       :index   i
                       :message (str "Task " i " (\"" (get-in specs [i :description]) "\")"
                                     " has invalid workspace-id: " (pr-str workspace-id) ".")})))
    (let [errs (persistent! errors)]
      (if (seq errs)
        {:valid false :errors errs}
        {:valid true}))))

(defn- format-validation-errors
  "Format validation errors into a single human-readable string."
  [errors]
  (str/join "\n" (map-indexed (fn [i e] (str (inc i) ". " (:message e))) errors)))

(defn create-graph!
  "Create a DAG of tasks for a ticket in a single transaction.

   Validates the graph first via `validate-graph`. On failure throws with
   structured `:errors` in ex-data so callers (e.g. Svar retry loop) can
   inspect and correct.

   Params:
   `conn`      - Datalevin connection.
   `ticket-id` - UUID. The owning ticket.
   `specs`     - Vector of maps, each with `:workspace-id`, `:description`,
                 optional `:acceptance-criteria` (data, will be pr-str'd),
                 optional `:cove-questions` (data, will be pr-str'd),
                 optional `:depends-on-indices` (vector of 0-based indices into specs).

   Returns:
   Vector of created task maps in spec order."
  [conn ticket-id specs]
  (let [{:keys [valid errors]} (validate-graph specs)]
    (when-not valid
      (throw (ex-info (str "Invalid task graph:\n" (format-validation-errors errors))
                      {:type :invalid-graph :errors errors :ticket-id ticket-id}))))
  (let [ticket (db.ticket/find-ticket conn ticket-id)]
    (when-not ticket
      (throw (ex-info "Ticket not found" {:ticket-id ticket-id})))
    (doseq [{:keys [workspace-id]} specs]
      (let [workspace (db.organization/find-workspace conn workspace-id)]
        (when-not workspace
          (throw (ex-info "Workspace not found" {:workspace-id workspace-id})))
        (when-not (= (get-in ticket [:ticket/organization :organization/id])
                     (get-in workspace [:workspace/organization :organization/id]))
          (throw (ex-info "Workspace must belong to the same organization as the ticket"
                          {:ticket-id ticket-id :workspace-id workspace-id})))))
    (let [task-ids (mapv (fn [_] (UUID/randomUUID)) specs)
          now      (java.util.Date.)
          tx-data  (map-indexed
                    (fn [i {:keys [workspace-id description acceptance-criteria cove-questions depends-on-indices]}]
                      (cond-> {:task/id          (task-ids i)
                               :task/ticket      [:ticket/id ticket-id]
                               :task/workspace   [:workspace/id workspace-id]
                               :task/description description
                               :task/status      :task.status/inbox
                               :task/created-at  now}
                        acceptance-criteria  (assoc :task/acceptance-criteria-edn (pr-str acceptance-criteria))
                        cove-questions       (assoc :task/cove-questions-edn (pr-str cove-questions))
                        (seq depends-on-indices) (assoc :task/depends-on
                                                        (mapv (fn [dep-i] [:task/id (task-ids dep-i)])
                                                              depends-on-indices))))
                    specs)]
      (db.task/create-tasks-batch! conn (vec tx-data) task-ids))))

(defn dependency-graph
  "Fetch all tasks for a ticket with resolved dependency refs.

   Params:
   `conn`      - Datalevin connection.
   `ticket-id` - UUID. Ticket identifier.

   Returns:
   Vector of task maps; each task's `:task/depends-on` is a vector of referenced task maps."
  [conn ticket-id]
  (db.task/task-dependency-graph conn ticket-id))

(defn update-status!
  "Advance a task to the next valid lifecycle status.

   Params:
   `conn` - Datalevin connection.
   `task-id` - UUID. Task identifier.
   `status` - Keyword. Next task status.

   Returns:
   Updated task map."
  [conn task-id status]
  (when-not (contains? allowed-statuses status)
    (throw (ex-info (str "Task status " status " is not allowed") {:status status})))
  (let [task (db.task/find-task conn task-id)
        current-status (:task/status task)]
    (when-not task
      (throw (ex-info "Task not found" {:task-id task-id})))
    (when-not (contains? (get allowed-transitions current-status #{}) status)
      (throw (ex-info (str "Invalid task status transition from " current-status " to " status)
                      {:task-id task-id :from current-status :to status})))
    (let [updated (db.task/update-task-status! conn task-id status)]
      (when (#{:task.status/reviewing :task.status/done} status)
        (db.task/create-notification!
         conn
         {:organization-id (get-in updated [:task/ticket :ticket/organization :organization/id])
          :task-id         task-id
          :status          status}))
      updated)))

(defn list-notifications
  "List organization notifications.

   Params:
   `conn` - Datalevin connection.
   `organization-id` - UUID. Organization identifier.

   Returns:
   Vector of notification maps."
  [conn organization-id]
  (db.task/list-notifications conn organization-id))
