(ns com.blockether.styrmann.db.task
  "Datalevin persistence for AI tasks and notifications."
  (:require
   [datalevin.core :as d])
  (:import
   [java.util UUID]))

(def ^:private task-pull
  [:task/id
   :task/description
   :task/status
   :task/created-at
   {:task/ticket [:ticket/id :ticket/title :ticket/description {:ticket/organization [:organization/id :organization/name]}]}
   {:task/workspace [:workspace/id :workspace/name :workspace/repository {:workspace/organization [:organization/id :organization/name]}]}])

(def ^:private notification-pull
  [:notification/id
   :notification/status
   :notification/created-at
   {:notification/organization [:organization/id :organization/name]}
   {:notification/task [:task/id :task/description :task/status {:task/ticket [:ticket/id :ticket/title :ticket/description]}]}])

(defn find-task
  "Fetch a task by its UUID.

   Params:
   `conn` - Datalevin connection.
   `task-id` - UUID. Task identifier.

   Returns:
   Task map or nil."
  [conn task-id]
  (d/pull (d/db conn) task-pull [:task/id task-id]))

(defn list-tasks-by-ticket
  "List tasks for a ticket.

   Params:
   `conn` - Datalevin connection.
   `ticket-id` - UUID. Ticket identifier.

   Returns:
   Vector of task maps."
  [conn ticket-id]
  (->> (d/q '[:find ?task-id
              :in $ ?ticket-id
              :where
              [?ticket :ticket/id ?ticket-id]
              [?task :task/ticket ?ticket]
              [?task :task/id ?task-id]]
            (d/db conn)
            ticket-id)
       (map first)
       (map #(find-task conn %))
       (sort-by :task/created-at #(compare %1 %2))
       vec))

(defn list-tasks-by-workspace
  "List tasks for a workspace.

   Params:
   `conn` - Datalevin connection.
   `workspace-id` - UUID. Workspace identifier.

   Returns:
   Vector of task maps."
  [conn workspace-id]
  (->> (d/q '[:find ?task-id
              :in $ ?workspace-id
              :where
              [?workspace :workspace/id ?workspace-id]
              [?task :task/workspace ?workspace]
              [?task :task/id ?task-id]]
            (d/db conn)
            workspace-id)
       (map first)
       (map #(find-task conn %))
       (sort-by :task/created-at #(compare %2 %1))
       vec))

(defn create-task!
  "Persist an AI task.

   Params:
   `conn` - Datalevin connection.
   `attrs` - Map with `:ticket-id`, `:workspace-id`, and `:description`.

   Returns:
   Persisted task map."
  [conn {:keys [ticket-id workspace-id description]}]
  (let [task-id (UUID/randomUUID)]
    (d/transact! conn [{:task/id          task-id
                        :task/ticket      [:ticket/id ticket-id]
                        :task/workspace   [:workspace/id workspace-id]
                        :task/description description
                        :task/status      :task.status/inbox
                        :task/created-at  (java.util.Date.)}])
    (find-task conn task-id)))

(defn update-task-status!
  "Replace the status of a task.

   Params:
   `conn` - Datalevin connection.
   `task-id` - UUID. Task identifier.
   `status` - Keyword. New task status.

   Returns:
   Updated task map."
  [conn task-id status]
  (d/transact! conn [{:db/id       [:task/id task-id]
                      :task/status status}])
  (find-task conn task-id))

(defn create-notification!
  "Persist an organization notification.

   Params:
   `conn` - Datalevin connection.
   `attrs` - Map with `:organization-id`, `:task-id`, and `:status`.

   Returns:
   Persisted notification map."
  [conn {:keys [organization-id task-id status]}]
  (let [notification-id (UUID/randomUUID)]
    (d/transact! conn [{:notification/id           notification-id
                        :notification/organization [:organization/id organization-id]
                        :notification/task         [:task/id task-id]
                        :notification/status       status
                        :notification/created-at   (java.util.Date.)}])
    (d/pull (d/db conn) notification-pull [:notification/id notification-id])))

(defn list-notifications
  "List notifications for an organization.

   Params:
   `conn` - Datalevin connection.
   `organization-id` - UUID. Organization identifier.

   Returns:
   Vector of notification maps."
  [conn organization-id]
  (->> (d/q '[:find ?notification-id
              :in $ ?organization-id
              :where
              [?organization :organization/id ?organization-id]
              [?notification :notification/organization ?organization]
              [?notification :notification/id ?notification-id]]
            (d/db conn)
            organization-id)
       (map first)
       (map #(d/pull (d/db conn) notification-pull [:notification/id %]))
       (sort-by :notification/created-at #(compare %1 %2))
       vec))
