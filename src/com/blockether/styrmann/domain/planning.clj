(ns com.blockether.styrmann.domain.planning
  "Domain rules for sprints, milestones, and ticket assignment."
  (:require
   [clojure.string :as str]
   [com.blockether.styrmann.db.organization :as db.organization]
   [com.blockether.styrmann.db.planning :as db.planning]
   [com.blockether.styrmann.db.ticket :as db.ticket]))

(defn- present-ticket [ticket]
  (let [sprint (or (:ticket/sprint ticket)
                   (get-in ticket [:ticket/milestone :milestone/sprint]))]
    (cond-> ticket
      sprint (assoc :ticket/sprint sprint))))

(defn- require-text! [value message]
  (let [trimmed (some-> value str/trim)]
    (when (str/blank? trimmed)
      (throw (ex-info message {:value value})))
    trimmed))

(defn create-sprint!
  "Create a sprint inside an organization.

   Params:
   `conn` - Datalevin connection.
   `attrs` - Map with `:organization-id`, `:name`, optional timeframe.

   Returns:
   Persisted sprint map."
  [conn {:keys [organization-id name start-date end-date]}]
  (when-not (db.organization/find-organization conn organization-id)
    (throw (ex-info "Organization not found" {:organization-id organization-id})))
  (db.planning/create-sprint!
   conn
   {:organization-id organization-id
    :name            (require-text! name "Sprint name is required")
    :start-date      start-date
    :end-date        end-date}))

(defn create-milestone!
  "Create a milestone inside a sprint.

   Params:
   `conn` - Datalevin connection.
   `attrs` - Map with `:sprint-id` and `:name`.

   Returns:
   Persisted milestone map."
  [conn {:keys [sprint-id name]}]
  (when-not (db.planning/find-sprint conn sprint-id)
    (throw (ex-info "Sprint not found" {:sprint-id sprint-id})))
  (db.planning/create-milestone!
   conn
   {:sprint-id sprint-id
    :name      (require-text! name "Milestone name is required")}))

(defn find-sprint-by-name
  "Find a sprint by organization and name.

   Params:
   `conn` - Datalevin connection.
   `organization-id` - UUID. Organization identifier.
   `sprint-name` - String. Sprint name.

   Returns:
   Sprint map or nil."
  [conn organization-id sprint-name]
  (db.planning/find-sprint-by-name conn organization-id sprint-name))

(defn find-milestone-by-name
  "Find a milestone by sprint and name.

   Params:
   `conn` - Datalevin connection.
   `sprint-id` - UUID. Sprint identifier.
   `milestone-name` - String. Milestone name.

   Returns:
   Milestone map or nil."
  [conn sprint-id milestone-name]
  (db.planning/find-milestone-by-name conn sprint-id milestone-name))

(defn assign-ticket-to-sprint!
  "Assign a ticket directly to a sprint.

   Params:
   `conn` - Datalevin connection.
   `attrs` - Map with `:ticket-id` and `:sprint-id`.

   Returns:
   Updated ticket map."
  [conn {:keys [ticket-id sprint-id]}]
  (let [ticket (db.ticket/find-ticket conn ticket-id)
        sprint (db.planning/find-sprint conn sprint-id)]
    (when-not ticket
      (throw (ex-info "Ticket not found" {:ticket-id ticket-id})))
    (when-not sprint
      (throw (ex-info "Sprint not found" {:sprint-id sprint-id})))
    (when-not (= (get-in ticket [:ticket/organization :organization/id])
                 (get-in sprint [:sprint/organization :organization/id]))
      (throw (ex-info "Sprint must belong to the same organization as the ticket"
                      {:ticket-id ticket-id :sprint-id sprint-id})))
    (present-ticket
     (db.ticket/update-ticket-assignment! conn {:ticket-id ticket-id
                                                :sprint-id sprint-id
                                                :milestone-id nil}))))

(defn assign-ticket-to-milestone!
  "Assign a ticket to a milestone and inherit the milestone sprint.

   Params:
   `conn` - Datalevin connection.
   `attrs` - Map with `:ticket-id` and `:milestone-id`.

   Returns:
   Updated ticket map."
  [conn {:keys [ticket-id milestone-id]}]
  (let [ticket (db.ticket/find-ticket conn ticket-id)
        milestone (db.planning/find-milestone conn milestone-id)
        sprint-id (get-in milestone [:milestone/sprint :sprint/id])]
    (when-not ticket
      (throw (ex-info "Ticket not found" {:ticket-id ticket-id})))
    (when-not milestone
      (throw (ex-info "Milestone not found" {:milestone-id milestone-id})))
    (when-not (= (get-in ticket [:ticket/organization :organization/id])
                 (get-in (db.planning/find-sprint conn sprint-id) [:sprint/organization :organization/id]))
      (throw (ex-info "Milestone sprint must belong to the same organization as the ticket"
                      {:ticket-id ticket-id :milestone-id milestone-id})))
    (present-ticket
     (db.ticket/update-ticket-assignment! conn {:ticket-id ticket-id
                                                :sprint-id nil
                                                :milestone-id milestone-id}))))
