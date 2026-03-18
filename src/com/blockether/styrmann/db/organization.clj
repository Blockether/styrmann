(ns com.blockether.styrmann.db.organization
  "Datalevin persistence for organizations and workspaces."
  (:require
   [datalevin.core :as d])
  (:import
   [java.util UUID]))

(def ^:private organization-pull
  [:organization/id
   :organization/name
   :organization/default?
   :organization/created-at])

(def ^:private workspace-pull
  [:workspace/id
   :workspace/name
   :workspace/repository
   :workspace/created-at
   {:workspace/organization organization-pull}])

(defn find-organization
  "Fetch an organization by its UUID.

   Params:
   `conn` - Datalevin connection.
   `organization-id` - UUID. The organization identifier.

   Returns:
   Organization map or nil."
  [conn organization-id]
  (d/pull (d/db conn) organization-pull [:organization/id organization-id]))

(defn list-organizations
  "List organizations sorted by default first, then creation time descending.

   Params:
   `conn` - Datalevin connection.

   Returns:
   Vector of organization maps."
  [conn]
  (->> (d/q '[:find ?organization-id
              :where
              [_ :organization/id ?organization-id]]
            (d/db conn))
       (map first)
       (map #(find-organization conn %))
       (sort-by (juxt (comp not :organization/default?) :organization/created-at)
                (fn [[default-a created-a] [default-b created-b]]
                  (let [default-compare (compare default-a default-b)]
                    (if (zero? default-compare)
                      (compare created-b created-a)
                      default-compare))))
       vec))

(defn find-default-organization
  "Fetch the default organization.

   Params:
   `conn` - Datalevin connection.

   Returns:
   Organization map or nil."
  [conn]
  (when-let [organization-id (d/q '[:find ?organization-id .
                                    :where
                                    [?organization :organization/default? true]
                                    [?organization :organization/id ?organization-id]]
                                  (d/db conn))]
    (find-organization conn organization-id)))

(defn create-organization!
  "Persist a new organization.

   Params:
   `conn` - Datalevin connection.
   `attrs` - Map with `:name`.

   Returns:
   Persisted organization map."
  [conn {:keys [name default?]}]
  (let [organization-id (UUID/randomUUID)
        existing-default? (some? (find-default-organization conn))
        default-organization? (if (some? default?) default? (not existing-default?))]
    (when default-organization?
      (when-let [existing-default (find-default-organization conn)]
        (d/transact! conn [{:db/id [:organization/id (:organization/id existing-default)]
                            :organization/default? false}])))
    (d/transact! conn [{:organization/id         organization-id
                        :organization/name       name
                        :organization/default?   default-organization?
                        :organization/created-at (java.util.Date.)}])
    (find-organization conn organization-id)))

(defn set-default-organization!
  "Mark one organization as default and clear it on others.

   Params:
   `conn` - Datalevin connection.
   `organization-id` - UUID. Organization identifier.

   Returns:
   Updated organization map."
  [conn organization-id]
  (when-let [existing-default (find-default-organization conn)]
    (when (not= organization-id (:organization/id existing-default))
      (d/transact! conn [{:db/id [:organization/id (:organization/id existing-default)]
                          :organization/default? false}])))
  (d/transact! conn [{:db/id [:organization/id organization-id]
                      :organization/default? true}])
  (find-organization conn organization-id))

(defn find-workspace
  "Fetch a workspace by its UUID.

   Params:
   `conn` - Datalevin connection.
   `workspace-id` - UUID. The workspace identifier.

   Returns:
   Workspace map or nil."
  [conn workspace-id]
  (d/pull (d/db conn) workspace-pull [:workspace/id workspace-id]))

(defn find-workspace-by-name
  "Fetch a workspace by organization and name.

   Params:
   `conn` - Datalevin connection.
   `organization-id` - UUID. Organization identifier.
   `workspace-name` - String. Workspace name.

   Returns:
   Workspace map or nil."
  [conn organization-id workspace-name]
  (when-let [workspace-id (d/q '[:find ?workspace-id .
                                 :in $ ?organization-id ?workspace-name
                                 :where
                                 [?organization :organization/id ?organization-id]
                                 [?workspace :workspace/organization ?organization]
                                 [?workspace :workspace/name ?workspace-name]
                                 [?workspace :workspace/id ?workspace-id]]
                               (d/db conn)
                               organization-id
                               workspace-name)]
    (find-workspace conn workspace-id)))

(defn list-workspaces
  "List workspaces for an organization.

   Params:
   `conn` - Datalevin connection.
   `organization-id` - UUID. Parent organization identifier.

   Returns:
   Vector of workspace maps."
  [conn organization-id]
  (->> (d/q '[:find ?workspace-id
              :in $ ?organization-id
              :where
              [?organization :organization/id ?organization-id]
              [?workspace :workspace/organization ?organization]
              [?workspace :workspace/id ?workspace-id]]
            (d/db conn)
            organization-id)
       (map first)
       (map #(find-workspace conn %))
       (sort-by :workspace/created-at #(compare %1 %2))
       vec))

(defn create-workspace!
  "Persist a new workspace inside an organization.

   Params:
   `conn` - Datalevin connection.
   `attrs` - Map with `:organization-id`, `:name`, and `:repository`.

   Returns:
   Persisted workspace map."
  [conn {:keys [organization-id name repository]}]
  (let [workspace-id (UUID/randomUUID)]
    (d/transact! conn [{:workspace/id           workspace-id
                        :workspace/organization [:organization/id organization-id]
                        :workspace/name         name
                        :workspace/repository   repository
                        :workspace/created-at   (java.util.Date.)}])
    (find-workspace conn workspace-id)))
