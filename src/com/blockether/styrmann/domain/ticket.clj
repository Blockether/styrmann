(ns com.blockether.styrmann.domain.ticket
  "Domain rules for business tickets and attachments."
  (:require
   [clojure.set :as set]
   [clojure.string :as str]
   [com.blockether.styrmann.db.organization :as db.organization]
   [com.blockether.styrmann.db.task :as db.task]
   [com.blockether.styrmann.db.ticket :as db.ticket]
   [com.blockether.styrmann.domain.acceptance-criteria :as acceptance-criteria]))

(def ^:private allowed-ticket-types
  #{:ticket.type/bug
    :ticket.type/chore
    :ticket.type/docs
    :ticket.type/feature
    :ticket.type/spike})

(defn- require-text! [value message]
  (let [trimmed (some-> value str/trim)]
    (when (str/blank? trimmed)
      (throw (ex-info message {:value value})))
    trimmed))

(defn- require-range! [value min-value max-value field]
  (when-not (and (integer? value) (<= min-value value max-value))
    (throw (ex-info (str field " must be an integer between " min-value " and " max-value)
                    {:field field :value value})))
  value)

(defn- normalize-attachments [uploads]
  (->> uploads
       (keep (fn [{:keys [filename content-type size tempfile]}]
               (when (and tempfile (seq filename) (pos? (or size 0)))
                 {:name         filename
                  :content-type (or content-type "application/octet-stream")
                  :size         size
                  :data         (java.nio.file.Files/readAllBytes (.toPath tempfile))})))
       vec))

(defn- present-ticket [ticket]
  (-> ticket
      (update :ticket/acceptance-criteria-edn acceptance-criteria/deserialize)
      (set/rename-keys {:ticket/acceptance-criteria-edn :ticket/acceptance-criteria})))

(defn create!
  "Create a business ticket.

   Params:
   `conn` - Datalevin connection.
   `attrs` - Map with ticket metadata and optional uploads.

   Returns:
   Persisted ticket map with decoded acceptance criteria."
  [conn {:keys [organization-id type title description acceptance-criteria-text
                acceptance-criteria story-points effort impact assignee attachments]}]
  (when-not (db.organization/find-organization conn organization-id)
    (throw (ex-info "Organization not found" {:organization-id organization-id})))
  (when (= :ticket.type/task type)
    (throw (ex-info "Ticket type :ticket.type/task is not allowed" {:type type})))
  (when-not (contains? allowed-ticket-types type)
    (throw (ex-info (str "Ticket type " type " is not allowed") {:type type})))
  (let [criteria (or acceptance-criteria
                     (acceptance-criteria/parse-text (require-text! acceptance-criteria-text "Acceptance criteria is required")))]
    (when (empty? criteria)
      (throw (ex-info "Acceptance criteria is required" {})))
    (present-ticket
     (db.ticket/create-ticket!
      conn
      {:organization-id         organization-id
       :type                    type
       :title                   (require-text! title "Ticket title is required")
       :description             (or (some-> description str/trim not-empty) "")
       :acceptance-criteria-edn (acceptance-criteria/serialize criteria)
       :story-points            (require-range! story-points 0 100 "Story points")
       :effort                  (require-range! effort 0 10 "Effort")
       :impact                  (require-range! impact 0 10 "Impact")
       :assignee                (require-text! assignee "Assignee is required")
       :attachments             (normalize-attachments attachments)}))))

(def ^:private allowed-ticket-statuses
  #{:ticket.status/open
    :ticket.status/in-progress
    :ticket.status/verification
    :ticket.status/closed})

(defn update-status!
  "Update a ticket's lifecycle status.

   Params:
   `conn` - Datalevin connection.
   `ticket-id` - UUID. Ticket identifier.
    `status` - Keyword. New status (:ticket.status/open, :ticket.status/in-progress, :ticket.status/verification, :ticket.status/closed).

   Returns:
   Updated ticket read model."
  [conn ticket-id status]
  (when-not (contains? allowed-ticket-statuses status)
    (throw (ex-info (str "Ticket status " status " is not allowed") {:status status})))
  (when-not (db.ticket/find-ticket conn ticket-id)
    (throw (ex-info "Ticket not found" {:ticket-id ticket-id})))
  (present-ticket (db.ticket/update-ticket-status! conn ticket-id status)))

(defn find-by-id
  "Fetch a ticket read model.

   Params:
   `conn` - Datalevin connection.
   `ticket-id` - UUID. Ticket identifier.

   Returns:
   Ticket map with decoded acceptance criteria and related tasks."
  [conn ticket-id]
  (when-let [ticket (db.ticket/find-ticket conn ticket-id)]
    (let [presented (present-ticket ticket)]
      (assoc presented
             :ticket/sprint
             (or (:ticket/sprint presented)
                 (get-in presented [:ticket/milestone :milestone/sprint]))
             :ticket/tasks
             (db.task/list-tasks-by-ticket conn ticket-id)))))

(defn backlog
  "List backlog tickets for an organization.

   Params:
   `conn` - Datalevin connection.
   `organization-id` - UUID. Organization identifier.

   Returns:
   Vector of ticket maps with decoded acceptance criteria."
  [conn organization-id]
  (mapv present-ticket (db.ticket/list-backlog-tickets conn organization-id)))

(defn find-attachment
  "Fetch an attachment for download.

   Params:
   `conn` - Datalevin connection.
   `attachment-id` - UUID. Attachment identifier.

   Returns:
   Attachment map or nil."
  [conn attachment-id]
  (db.ticket/find-attachment conn attachment-id))
