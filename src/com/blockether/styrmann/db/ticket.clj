(ns com.blockether.styrmann.db.ticket
  "Datalevin persistence for tickets and attachments."
  (:require
   [datalevin.core :as d])
  (:import
   [java.util UUID]))

(def ^:private ticket-pull
  [:ticket/id
   :ticket/type
   :ticket/title
   :ticket/description
   :ticket/status
   :ticket/acceptance-criteria-edn
   :ticket/story-points
   :ticket/effort
   :ticket/impact
   :ticket/assignee
   :ticket/created-at
   {:ticket/organization [:organization/id :organization/name]}
   {:ticket/sprint [:db/id :sprint/id :sprint/name :sprint/start-date :sprint/end-date]}
   {:ticket/milestone [:db/id :milestone/id :milestone/name {:milestone/sprint [:sprint/id :sprint/name]}]}])

(def ^:private ticket-assignment-pull
  [:db/id
   :ticket/id
   {:ticket/sprint [:db/id :sprint/id]}
   {:ticket/milestone [:db/id :milestone/id]}])

(def ^:private attachment-summary-pull
  [:attachment/id
   :attachment/name
   :attachment/content-type
   :attachment/size
   :attachment/created-at])

(def ^:private attachment-full-pull
  [:attachment/id
   :attachment/name
   :attachment/content-type
   :attachment/size
   :attachment/data
   :attachment/created-at
   {:attachment/ticket [:ticket/id]}])

(defn find-ticket
  "Fetch a ticket by its UUID.

   Params:
   `conn` - Datalevin connection.
   `ticket-id` - UUID. Ticket identifier.

   Returns:
   Ticket map with nested assignment refs and attachments."
  [conn ticket-id]
  (when-let [ticket (d/pull (d/db conn) ticket-pull [:ticket/id ticket-id])]
    (assoc ticket
           :ticket/attachments
           (->> (d/q '[:find ?attachment-id
                       :in $ ?ticket-id
                       :where
                       [?ticket :ticket/id ?ticket-id]
                       [?attachment :attachment/ticket ?ticket]
                       [?attachment :attachment/id ?attachment-id]]
                     (d/db conn)
                     ticket-id)
                (map first)
                (map #(d/pull (d/db conn) attachment-summary-pull [:attachment/id %]))
                (sort-by :attachment/created-at #(compare %1 %2))
                vec))))

(defn list-backlog-tickets
  "List organization backlog tickets.

   Params:
   `conn` - Datalevin connection.
   `organization-id` - UUID. Organization identifier.

   Returns:
   Vector of ticket maps."
  [conn organization-id]
  (->> (d/q '[:find ?ticket-id
              :in $ ?organization-id
              :where
              [?organization :organization/id ?organization-id]
              [?ticket :ticket/organization ?organization]
              [?ticket :ticket/id ?ticket-id]
              (not [?ticket :ticket/sprint _])
              (not [?ticket :ticket/milestone _])]
            (d/db conn)
            organization-id)
       (map first)
       (map #(find-ticket conn %))
       (sort-by :ticket/created-at #(compare %1 %2))
       vec))

(defn list-tickets-by-sprint
  "List tickets directly assigned to a sprint.

   Params:
   `conn` - Datalevin connection.
   `sprint-id` - UUID. Sprint identifier.

   Returns:
   Vector of ticket maps."
  [conn sprint-id]
  (->> (d/q '[:find ?ticket-id
              :in $ ?sprint-id
              :where
              [?sprint :sprint/id ?sprint-id]
              [?ticket :ticket/sprint ?sprint]
              [?ticket :ticket/id ?ticket-id]
              (not [?ticket :ticket/milestone _])]
            (d/db conn)
            sprint-id)
       (map first)
       (map #(find-ticket conn %))
       (sort-by :ticket/created-at #(compare %1 %2))
       vec))

(defn list-tickets-by-milestone
  "List tickets assigned to a milestone.

   Params:
   `conn` - Datalevin connection.
   `milestone-id` - UUID. Milestone identifier.

   Returns:
   Vector of ticket maps."
  [conn milestone-id]
  (->> (d/q '[:find ?ticket-id
              :in $ ?milestone-id
              :where
              [?milestone :milestone/id ?milestone-id]
              [?ticket :ticket/milestone ?milestone]
              [?ticket :ticket/id ?ticket-id]]
            (d/db conn)
            milestone-id)
       (map first)
       (map #(find-ticket conn %))
       (sort-by :ticket/created-at #(compare %1 %2))
       vec))

(defn create-ticket!
  "Persist a ticket and optional attachments.

   Params:
   `conn` - Datalevin connection.
   `attrs` - Map with organization, metadata, acceptance criteria EDN, and attachments.

   Returns:
   Persisted ticket map."
  [conn {:keys [organization-id type title description acceptance-criteria-edn
                story-points effort impact assignee attachments]}]
  (let [ticket-id (UUID/randomUUID)]
    (d/transact! conn [{:ticket/id                      ticket-id
                        :ticket/organization            [:organization/id organization-id]
                        :ticket/type                    type
                        :ticket/title                   title
                        :ticket/description             description
                        :ticket/status                  :ticket.status/open
                        :ticket/acceptance-criteria-edn acceptance-criteria-edn
                        :ticket/story-points            story-points
                        :ticket/effort                  effort
                        :ticket/impact                  impact
                        :ticket/assignee                assignee
                        :ticket/created-at              (java.util.Date.)}])
    (when (seq attachments)
      (d/transact! conn
                   (mapv (fn [{:keys [name content-type size data]}]
                           {:attachment/id           (UUID/randomUUID)
                            :attachment/ticket       [:ticket/id ticket-id]
                            :attachment/name         name
                            :attachment/content-type content-type
                            :attachment/size         size
                            :attachment/data         data
                            :attachment/created-at   (java.util.Date.)})
                         attachments)))
    (find-ticket conn ticket-id)))

(defn update-ticket-assignment!
  "Replace sprint and milestone assignment on a ticket.

   Params:
   `conn` - Datalevin connection.
   `attrs` - Map with `:ticket-id`, optional `:sprint-id`, optional `:milestone-id`.

   Returns:
   Updated ticket map."
  [conn {:keys [ticket-id sprint-id milestone-id]}]
  (let [current (d/pull (d/db conn) ticket-assignment-pull [:ticket/id ticket-id])
        tx (cond-> []
             (-> current :ticket/sprint :db/id)
             (conj [:db/retract [:ticket/id ticket-id] :ticket/sprint (-> current :ticket/sprint :db/id)])

             (-> current :ticket/milestone :db/id)
             (conj [:db/retract [:ticket/id ticket-id] :ticket/milestone (-> current :ticket/milestone :db/id)])

             sprint-id
             (conj [:db/add [:ticket/id ticket-id] :ticket/sprint [:sprint/id sprint-id]])

             milestone-id
             (conj [:db/add [:ticket/id ticket-id] :ticket/milestone [:milestone/id milestone-id]]))]
    (when (seq tx)
      (d/transact! conn tx))
    (find-ticket conn ticket-id)))

(defn update-ticket-status!
  "Update the status of a ticket.

   Params:
   `conn` - Datalevin connection.
   `ticket-id` - UUID. Ticket identifier.
   `status` - Keyword. New ticket status.

   Returns:
   Updated ticket map."
  [conn ticket-id status]
  (d/transact! conn [{:db/id [:ticket/id ticket-id]
                      :ticket/status status}])
  (find-ticket conn ticket-id))

(defn find-attachment
  "Fetch an attachment by its UUID.

   Params:
   `conn` - Datalevin connection.
   `attachment-id` - UUID. Attachment identifier.

   Returns:
   Attachment map including bytes or nil."
  [conn attachment-id]
  (d/pull (d/db conn) attachment-full-pull [:attachment/id attachment-id]))
