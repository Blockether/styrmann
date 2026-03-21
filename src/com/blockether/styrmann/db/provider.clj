(ns com.blockether.styrmann.db.provider
  "Datalevin persistence for LLM providers."
  (:require
   [datalevin.core :as d])
  (:import
   [java.util UUID]))

(def ^:private provider-pull
  [:provider/id
   :provider/name
   :provider/base-url
   :provider/api-key
   :provider/default?
   :provider/created-at])

(defn find-provider
  "Fetch a provider by its UUID.

   Params:
   `conn` - Datalevin connection.
   `provider-id` - UUID. The provider identifier.

   Returns:
   Provider map or nil."
  [conn provider-id]
  (d/pull (d/db conn) provider-pull [:provider/id provider-id]))

(defn list-providers
  "List all providers sorted by default first, then creation time.

   Params:
   `conn` - Datalevin connection.

   Returns:
   Vector of provider maps."
  [conn]
  (->> (d/q '[:find ?provider-id
              :where
              [_ :provider/id ?provider-id]]
            (d/db conn))
       (map first)
       (map #(find-provider conn %))
       (sort-by (juxt (comp not :provider/default?) :provider/created-at))
       vec))

(defn find-default-provider
  "Fetch the default provider.

   Params:
   `conn` - Datalevin connection.

   Returns:
   Provider map or nil."
  [conn]
  (let [result (d/q '[:find (pull ?e [*])
                      :where
                      [?e :provider/default? true]]
                    (d/db conn))]
    (when (seq result)
      (ffirst result))))

(defn- clear-default! [conn]
  (let [ids (map first (d/q '[:find ?provider-id
                              :where
                              [_ :provider/id ?provider-id]
                              [?e :provider/default? true]]
                            (d/db conn)))]
    (when (seq ids)
      (d/transact! conn (mapv #(hash-map :db/id [:provider/id %] :provider/default? false) ids)))))

(defn create-provider!
  "Create a new LLM provider.

   Params:
   `conn` - Datalevin connection.
   `attrs` - Map with keys:
     - :name (string, required)
     - :base-url (string, required)
     - :api-key (string, required)
     - :default? (boolean, optional)

   Returns:
   Created provider map."
  [conn {:keys [name base-url api-key default?]}]
  (let [provider-id (UUID/randomUUID)
        default? (boolean default?)]
    (when default?
      (clear-default! conn))
    (d/transact! conn [{:provider/id         provider-id
                        :provider/name       name
                        :provider/base-url   base-url
                        :provider/api-key    api-key
                        :provider/default?   default?
                        :provider/created-at (java.util.Date.)}])
    (find-provider conn provider-id)))

(defn update-provider!
  "Update a provider by ID.

   Params:
   `conn` - Datalevin connection.
   `provider-id` - UUID.
   `attrs` - Map with optional keys: :name, :base-url, :api-key, :default?

   Returns:
   Updated provider map or nil if not found."
  [conn provider-id {:keys [name base-url api-key default?]}]
  (if (find-provider conn provider-id)
    (do
      (when default?
        (clear-default! conn))
      (d/transact! conn [(cond-> {:db/id [:provider/id provider-id]}
                           name      (assoc :provider/name name)
                           base-url  (assoc :provider/base-url base-url)
                           api-key   (assoc :provider/api-key api-key)
                           (some? default?) (assoc :provider/default? default?))])
      (find-provider conn provider-id))
    nil))

(defn set-default-provider!
  "Set a provider as the default, clearing any existing default.

   Params:
   `conn` - Datalevin connection.
   `provider-id` - UUID.

   Returns:
   Updated provider map."
  [conn provider-id]
  (update-provider! conn provider-id {:default? true}))
