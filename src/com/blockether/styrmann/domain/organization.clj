(ns com.blockether.styrmann.domain.organization
  "Domain rules for organizations and workspaces."
  (:require
   [clojure.edn :as edn]
   [clojure.set :as set]
   [clojure.string :as str]
   [com.blockether.styrmann.db.organization :as db.organization]
   [com.blockether.styrmann.db.planning :as db.planning]
   [com.blockether.styrmann.db.task :as db.task]
   [com.blockether.styrmann.db.ticket :as db.ticket]))

(defn- require-text! [value message]
  (let [trimmed (some-> value str/trim)]
    (when (str/blank? trimmed)
      (throw (ex-info message {:value value})))
    trimmed))

(defn- present-ticket [ticket]
  (-> ticket
      (update :ticket/acceptance-criteria-edn (fn [value] (if (string? value) (edn/read-string value) value)))
      (set/rename-keys {:ticket/acceptance-criteria-edn :ticket/acceptance-criteria})))

(defn create!
  "Create an organization.

   Params:
   `conn` - Datalevin connection.
   `attrs` - Map with `:name`.

   Returns:
   Persisted organization map."
  [conn {:keys [name]}]
  (db.organization/create-organization! conn {:name (require-text! name "Organization name is required")}))

(defn list-organizations
  "List organizations.

   Params:
   `conn` - Datalevin connection.

   Returns:
   Vector of organization maps."
  [conn]
  (db.organization/list-organizations conn))

(defn default-organization
  "Get the default organization, or the first organization if none is marked default.

   Params:
   `conn` - Datalevin connection.

   Returns:
   Organization map or nil."
  [conn]
  (or (db.organization/find-default-organization conn)
      (first (db.organization/list-organizations conn))))

(defn create-workspace!
  "Create a workspace inside an organization.

   Params:
   `conn` - Datalevin connection.
   `attrs` - Map with `:organization-id`, `:name`, and `:repository`.

   Returns:
   Persisted workspace map."
  [conn {:keys [organization-id name repository]}]
  (when-not (db.organization/find-organization conn organization-id)
    (throw (ex-info "Organization not found" {:organization-id organization-id})))
  (db.organization/create-workspace!
   conn
   {:organization-id organization-id
    :name            (require-text! name "Workspace name is required")
    :repository      (require-text! repository "Workspace repository is required")}))

(defn set-default!
  "Mark one organization as the default landing organization.

   Params:
   `conn` - Datalevin connection.
   `organization-id` - UUID. Organization identifier.

   Returns:
   Updated organization map."
  [conn organization-id]
  (when-not (db.organization/find-organization conn organization-id)
    (throw (ex-info "Organization not found" {:organization-id organization-id})))
  (db.organization/set-default-organization! conn organization-id))

(defn find-workspace-by-name
  "Find a workspace by organization and name.

   Params:
   `conn` - Datalevin connection.
   `organization-id` - UUID. Organization identifier.
   `workspace-name` - String. Workspace name.

   Returns:
   Workspace map or nil."
  [conn organization-id workspace-name]
  (db.organization/find-workspace-by-name conn organization-id workspace-name))

(defn overview
  "Assemble an organization overview read model for SSR.

   Params:
   `conn` - Datalevin connection.
   `organization-id` - UUID. Organization identifier.

   Returns:
   Organization map enriched with workspaces, backlog, notifications, and sprint hierarchy."
  [conn organization-id]
  (when-let [organization (db.organization/find-organization conn organization-id)]
    (assoc organization
           :organization/workspaces
           (db.organization/list-workspaces conn organization-id)

           :organization/backlog
           (mapv present-ticket (db.ticket/list-backlog-tickets conn organization-id))

           :organization/notifications
           (db.task/list-notifications conn organization-id)

           :organization/sprints
           (mapv (fn [sprint]
                   (assoc sprint
                          :sprint/direct-tickets
                          (mapv present-ticket
                                (db.ticket/list-tickets-by-sprint conn (:sprint/id sprint)))

                          :sprint/milestones
                          (mapv (fn [milestone]
                                  (assoc milestone
                                         :milestone/tickets
                                         (mapv present-ticket
                                               (db.ticket/list-tickets-by-milestone conn (:milestone/id milestone)))))
                                (db.planning/list-milestones conn (:sprint/id sprint)))))
                 (db.planning/list-sprints conn organization-id)))))
