(ns com.blockether.styrmann.domain.task
  "Domain rules for AI tasks and notifications."
  (:require
   [clojure.string :as str]
   [com.blockether.styrmann.db.organization :as db.organization]
   [com.blockether.styrmann.db.task :as db.task]
   [com.blockether.styrmann.db.ticket :as db.ticket]))

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
   `attrs` - Map with `:ticket-id`, `:workspace-id`, and `:description`.

   Returns:
   Persisted task map."
  [conn {:keys [ticket-id workspace-id description]}]
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
     {:ticket-id    ticket-id
      :workspace-id workspace-id
      :description  (require-text! description "Task description is required")})))

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
