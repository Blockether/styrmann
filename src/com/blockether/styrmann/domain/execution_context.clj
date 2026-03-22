(ns com.blockether.styrmann.domain.execution-context
  "Builds the execution context map from a Datalevin connection.

   This is the adapter layer — it imports all `db.*` and `domain.*` namespaces
   and wires them into the callback-based context map that execution/ expects."
  (:require
   [clojure.edn :as edn]
   [com.blockether.styrmann.db.git :as db.git]
   [com.blockether.styrmann.db.organization :as db.organization]
   [com.blockether.styrmann.db.provider :as db.provider]
   [com.blockether.styrmann.db.session :as db.session]
   [com.blockether.styrmann.db.task :as db.task]
   [com.blockether.styrmann.domain.task :as domain.task]
   [datalevin.core :as d]))

(defn- verify-acceptance-criterion!
  "Domain callback: look up AC entity by task-id + index, transact verdict.
   Auto-migrates from EDN if no AC entities exist yet.

   Returns map with :text key."
  [conn task-id index verdict-kw reasoning]
  (let [task (or (db.task/find-task conn task-id)
                 (throw (ex-info "Task not found" {:task-id task-id})))
        ac-eid (or (d/q '[:find ?e .
                          :in $ ?task-id ?idx
                          :where
                          [?t :task/id ?task-id]
                          [?e :task.ac/task ?t]
                          [?e :task.ac/index ?idx]]
                     (d/db conn) task-id index)
                   ;; Auto-migrate from EDN if no entities exist
                   (when-let [edn-str (:task/acceptance-criteria-edn task)]
                     (let [criteria (try (edn/read-string edn-str) (catch Exception _ []))]
                       (when (seq criteria)
                         (d/transact!
                           conn
                           (map-indexed
                             (fn [i c]
                               {:task.ac/id      (java.util.UUID/randomUUID)
                                :task.ac/task    [:task/id task-id]
                                :task.ac/index   i
                                :task.ac/text    (if (map? c) (:text c) (str c))
                                :task.ac/verdict :ac.status/pending})
                             criteria))
                         (d/q '[:find ?e .
                                :in $ ?task-id ?idx
                                :where
                                [?t :task/id ?task-id]
                                [?e :task.ac/task ?t]
                                [?e :task.ac/index ?idx]]
                           (d/db conn) task-id index)))))
        _ (when-not ac-eid
            (throw (ex-info "AC not found" {:task-id task-id :index index})))
        ac (d/pull (d/db conn) [:task.ac/id :task.ac/text :task.ac/index] ac-eid)]
    (d/transact! conn [{:db/id             ac-eid
                        :task.ac/verdict   verdict-kw
                        :task.ac/reasoning reasoning
                        :task.ac/verified-at (java.util.Date.)}])
    {:text (:task.ac/text ac)}))

(defn- record-deliverable!
  "Domain callback: read/update deliverables EDN on a task.

   Returns map with :ok? true and :deliverables vector."
  [conn task-id title description status]
  (let [task (or (db.task/find-task conn task-id)
                 (throw (ex-info "Task not found" {:task-id task-id})))
        existing   (or (some-> (:task/deliverables-edn task) edn/read-string) [])
        entry      {:title title :description description :status status}
        updated    (let [idx (first (keep-indexed (fn [i d] (when (= (:title d) title) i)) existing))]
                     (if idx
                       (assoc existing idx entry)
                       (conj existing entry)))]
    (d/transact!
      conn
      [{:db/id                 [:task/id task-id]
        :task/deliverables-edn (pr-str updated)}])
    {:ok?          true
     :deliverables updated}))

(defn make-context
  "Build an execution context map from a Datalevin connection.

   The returned map contains all `:store/*` and `:domain/*` callbacks
   that execution/ namespaces need.

   Params:
   `conn` - Datalevin connection.

   Returns:
   Execution context map."
  [conn]
  {;; -- store: persistence callbacks ------------------------------------------
   :store/find-task                       (partial db.task/find-task conn)
   :store/find-workspace                  (partial db.organization/find-workspace conn)
   :store/find-environment-by-workspace   (partial db.session/find-environment-by-workspace conn)
   :store/find-session                    (partial db.session/find-session conn)
   :store/find-agent-by-key               (partial db.session/find-agent-by-key conn)
   :store/create-environment!             (partial db.session/create-environment! conn)
   :store/create-workflow!                (partial db.session/create-workflow! conn)
   :store/create-session!                 (partial db.session/create-session! conn)
   :store/create-session-event!           (partial db.session/create-session-event! conn)
   :store/create-session-message!         (partial db.session/create-session-message! conn)
   :store/create-tool-call!               (partial db.session/create-tool-call! conn)
   :store/create-agent!                   (partial db.session/create-agent! conn)
   :store/finish-tool-call!               (partial db.session/finish-tool-call! conn)
   :store/mark-session-finished!          (partial db.session/mark-session-finished! conn)
   :store/mark-workflow-finished!         (partial db.session/mark-workflow-finished! conn)
   :store/upsert-tool-definition!         (partial db.session/upsert-tool-definition! conn)
   :store/list-tool-definitions           (partial db.session/list-tool-definitions conn)
   :store/list-tool-calls-by-session      (partial db.session/list-tool-calls-by-session conn)
   :store/list-session-events             (partial db.session/list-session-events conn)
   :store/list-session-messages           (partial db.session/list-session-messages conn)
   :store/list-sessions-by-task           (partial db.session/list-sessions-by-task conn)
   :store/list-environments-by-organization (partial db.session/list-environments-by-organization conn)
   :store/update-environment-by-workspace! (partial db.session/update-environment-by-workspace! conn)
   ;; git persistence
   :store/git-find-repo-by-workspace      (partial db.git/find-repo-by-workspace conn)
   :store/git-list-commits-by-repo        (partial db.git/list-commits-by-repo conn)
   :store/git-list-branches-by-repo       (partial db.git/list-branches-by-repo conn)
   :store/git-create-repo!                (partial db.git/create-repo! conn)
   :store/git-upsert-author!              (partial db.git/upsert-author! conn)
   :store/git-create-commit!              (partial db.git/create-commit! conn)
   :store/git-create-branch!              (partial db.git/create-branch! conn)
   :store/git-update-branch-head!         (partial db.git/update-branch-head! conn)
   :store/git-create-worktree!            (partial db.git/create-worktree! conn)
   ;; -- domain: business-rule callbacks ---------------------------------------
   :domain/update-task-status!            (partial domain.task/update-status! conn)
   :domain/ready-dependents               (partial domain.task/ready-dependents conn)
   :domain/find-default-provider          (fn [] (db.provider/find-default-provider conn))
   ;; -- domain: AC + deliverable operations -----------------------------------
   :domain/verify-acceptance-criterion!   (partial verify-acceptance-criterion! conn)
   :domain/record-deliverable!            (partial record-deliverable! conn)})
