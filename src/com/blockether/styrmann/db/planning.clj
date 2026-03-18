(ns com.blockether.styrmann.db.planning
  "Datalevin persistence for sprints and milestones."
  (:require
   [datalevin.core :as d])
  (:import
   [java.util UUID]))

(def ^:private sprint-pull
  [:sprint/id
   :sprint/name
   :sprint/start-date
   :sprint/end-date
   :sprint/created-at
   {:sprint/organization [:organization/id :organization/name]}])

(def ^:private milestone-pull
  [:milestone/id
   :milestone/name
   :milestone/created-at
   {:milestone/sprint [:sprint/id :sprint/name]}])

(defn find-sprint
  "Fetch a sprint by its UUID.

   Params:
   `conn` - Datalevin connection.
   `sprint-id` - UUID. Sprint identifier.

   Returns:
   Sprint map or nil."
  [conn sprint-id]
  (d/pull (d/db conn) sprint-pull [:sprint/id sprint-id]))

(defn find-sprint-by-name
  "Fetch a sprint by organization and name.

   Params:
   `conn` - Datalevin connection.
   `organization-id` - UUID. Organization identifier.
   `sprint-name` - String. Sprint name.

   Returns:
   Sprint map or nil."
  [conn organization-id sprint-name]
  (when-let [sprint-id (d/q '[:find ?sprint-id .
                              :in $ ?organization-id ?sprint-name
                              :where
                              [?organization :organization/id ?organization-id]
                              [?sprint :sprint/organization ?organization]
                              [?sprint :sprint/name ?sprint-name]
                              [?sprint :sprint/id ?sprint-id]]
                            (d/db conn)
                            organization-id
                            sprint-name)]
    (find-sprint conn sprint-id)))

(defn list-sprints
  "List sprints for an organization.

   Params:
   `conn` - Datalevin connection.
   `organization-id` - UUID. Organization identifier.

   Returns:
   Vector of sprint maps."
  [conn organization-id]
  (->> (d/q '[:find ?sprint-id
              :in $ ?organization-id
              :where
              [?organization :organization/id ?organization-id]
              [?sprint :sprint/organization ?organization]
              [?sprint :sprint/id ?sprint-id]]
            (d/db conn)
            organization-id)
       (map first)
       (map #(find-sprint conn %))
       (sort-by :sprint/created-at #(compare %1 %2))
       vec))

(defn create-sprint!
  "Persist a sprint.

   Params:
   `conn` - Datalevin connection.
   `attrs` - Map with `:organization-id`, `:name`, optional `:start-date`, `:end-date`.

   Returns:
   Persisted sprint map."
  [conn {:keys [organization-id name start-date end-date]}]
  (let [sprint-id (UUID/randomUUID)]
    (d/transact! conn [(cond-> {:sprint/id           sprint-id
                                :sprint/organization [:organization/id organization-id]
                                :sprint/name         name
                                :sprint/created-at   (java.util.Date.)}
                         start-date (assoc :sprint/start-date start-date)
                         end-date   (assoc :sprint/end-date end-date))])
    (find-sprint conn sprint-id)))

(defn find-milestone
  "Fetch a milestone by its UUID.

   Params:
   `conn` - Datalevin connection.
   `milestone-id` - UUID. Milestone identifier.

   Returns:
   Milestone map or nil."
  [conn milestone-id]
  (d/pull (d/db conn) milestone-pull [:milestone/id milestone-id]))

(defn find-milestone-by-name
  "Fetch a milestone by sprint and name.

   Params:
   `conn` - Datalevin connection.
   `sprint-id` - UUID. Sprint identifier.
   `milestone-name` - String. Milestone name.

   Returns:
   Milestone map or nil."
  [conn sprint-id milestone-name]
  (when-let [milestone-id (d/q '[:find ?milestone-id .
                                 :in $ ?sprint-id ?milestone-name
                                 :where
                                 [?sprint :sprint/id ?sprint-id]
                                 [?milestone :milestone/sprint ?sprint]
                                 [?milestone :milestone/name ?milestone-name]
                                 [?milestone :milestone/id ?milestone-id]]
                               (d/db conn)
                               sprint-id
                               milestone-name)]
    (find-milestone conn milestone-id)))

(defn list-milestones
  "List milestones for a sprint.

   Params:
   `conn` - Datalevin connection.
   `sprint-id` - UUID. Sprint identifier.

   Returns:
   Vector of milestone maps."
  [conn sprint-id]
  (->> (d/q '[:find ?milestone-id
              :in $ ?sprint-id
              :where
              [?sprint :sprint/id ?sprint-id]
              [?milestone :milestone/sprint ?sprint]
              [?milestone :milestone/id ?milestone-id]]
            (d/db conn)
            sprint-id)
       (map first)
       (map #(find-milestone conn %))
       (sort-by :milestone/created-at #(compare %1 %2))
       vec))

(defn create-milestone!
  "Persist a milestone.

   Params:
   `conn` - Datalevin connection.
   `attrs` - Map with `:sprint-id` and `:name`.

   Returns:
   Persisted milestone map."
  [conn {:keys [sprint-id name]}]
  (let [milestone-id (UUID/randomUUID)]
    (d/transact! conn [{:milestone/id         milestone-id
                        :milestone/sprint     [:sprint/id sprint-id]
                        :milestone/name       name
                        :milestone/created-at (java.util.Date.)}])
    (find-milestone conn milestone-id)))
