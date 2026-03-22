(ns com.blockether.styrmann.execution.tools.system
  "System tools for emitting session events, recording deliverables, and
   advancing task status from within an RLM execution session."
  (:require
   [clojure.edn :as edn]
   [com.blockether.styrmann.db.task :as db.task]
   [com.blockether.styrmann.domain.task :as domain.task]
   [com.blockether.styrmann.execution.session :as session]
   [datalevin.core :as d])
  (:import
   [java.util UUID]))

(def ^:private allowed-deliverable-statuses
  #{"pending" "done"})

(def ^:private status->keyword
  {"implementing" :task.status/implementing
   "testing"      :task.status/testing
   "done"         :task.status/done})

(defn signal-event
  "Emit a named event on the running session.

   Context: {:conn conn :session-id uuid}
   Params:  {:type \"string\" :message \"string\" :payload {...}}
   Returns: {:ok? true}"
  [{:keys [conn session-id]} {:keys [type message payload]}]
  (session/record-session-event!
    conn
    {:session-id session-id
     :type       (keyword "session.event.type" type)
     :message    (str message)
     :payload    payload})
  {:ok? true})

(defn record-deliverable
  "Record or update a deliverable on a task.

   Reads the current `:task/deliverables-edn` EDN vector, appends the new
   deliverable (keyed by title for idempotency), and persists it back.

   Context: {:conn conn}
   Params:  {:task-id UUID-or-string
             :title \"string\"
             :description \"string\"
             :status \"pending\"|\"done\"}
   Returns: {:ok? true :deliverables [...]}"
  [{:keys [conn]} {:keys [task-id title description status]}]
  (let [id     (if (string? task-id) (UUID/fromString task-id) task-id)
        task   (db.task/find-task conn id)]
    (when-not task
      (throw (ex-info "Task not found" {:task-id task-id})))
    (when-not (contains? allowed-deliverable-statuses status)
      (throw (ex-info (str "Invalid deliverable status: " status)
               {:status status :allowed allowed-deliverable-statuses})))
    (let [existing   (or (some-> (:task/deliverables-edn task) edn/read-string) [])
          entry      {:title title :description description :status status}
          updated    (let [idx (first (keep-indexed (fn [i d] (when (= (:title d) title) i)) existing))]
                       (if idx
                         (assoc existing idx entry)
                         (conj existing entry)))]
      (d/transact!
        conn
        [{:db/id                 [:task/id id]
          :task/deliverables-edn (pr-str updated)}])
      {:ok?          true
       :deliverables updated})))

(def ^:private ac-verdict->keyword
  {"verified" :ac.status/verified
   "failed"   :ac.status/failed
   "skipped"  :ac.status/skipped
   "pending"  :ac.status/pending})

(defn verify-acceptance-criterion
  "Mark an acceptance criterion as verified, failed, or skipped.

   Each AC is its own Datalevin entity (task.ac/*), so parallel calls are safe.
   Looks up the criterion by task-id + index, transacts verdict atomically.

   Context: {:conn conn :session-id uuid}
   Params:  {:task-id UUID-or-string
             :index int — 0-based AC index
             :verdict \"verified\"|\"failed\"|\"skipped\"
             :reasoning \"string explaining why\"}
   Returns: {:ok? true :criterion {...}}"
  [{:keys [conn session-id]} {:keys [task-id index verdict reasoning]}]
  (let [id    (if (string? task-id) (UUID/fromString task-id) task-id)
        task  (db.task/find-task conn id)
        _     (when-not task (throw (ex-info "Task not found" {:task-id task-id})))
        kw    (get ac-verdict->keyword verdict)
        _     (when-not kw
                (throw (ex-info (str "Invalid verdict: " verdict) {:allowed (keys ac-verdict->keyword)})))
        idx   (long index)
        ;; Find the AC entity by task ref + index (auto-create from EDN if missing)
        ac-eid (or (d/q '[:find ?e .
                          :in $ ?task-id ?idx
                          :where
                          [?t :task/id ?task-id]
                          [?e :task.ac/task ?t]
                          [?e :task.ac/index ?idx]]
                     (d/db conn) id idx)
                   ;; Auto-migrate from EDN if no entities exist
                 (when-let [edn-str (:task/acceptance-criteria-edn task)]
                   (let [criteria (try (edn/read-string edn-str) (catch Exception _ []))]
                     (when (seq criteria)
                       (d/transact!
                         conn
                         (map-indexed
                           (fn [i c]
                             {:task.ac/id      (java.util.UUID/randomUUID)
                              :task.ac/task    [:task/id id]
                              :task.ac/index   i
                              :task.ac/text    (if (map? c) (:text c) (str c))
                              :task.ac/verdict :ac.status/pending})
                           criteria))
                         ;; Re-query after migration
                       (d/q '[:find ?e .
                              :in $ ?task-id ?idx
                              :where
                              [?t :task/id ?task-id]
                              [?e :task.ac/task ?t]
                              [?e :task.ac/index ?idx]]
                         (d/db conn) id idx)))))
        _     (when-not ac-eid
                (throw (ex-info "AC not found" {:task-id task-id :index idx})))
        ac    (d/pull (d/db conn) [:task.ac/id :task.ac/text :task.ac/index] ac-eid)]
    ;; Atomic single-entity update — no read-modify-write race
    (d/transact! conn [{:db/id          ac-eid
                        :task.ac/verdict   kw
                        :task.ac/reasoning (str reasoning)
                        :task.ac/verified-at (java.util.Date.)}])
    (when session-id
      (session/record-session-event!
        conn
        {:session-id session-id
         :type :session.event.type/ac-verification
         :message (str "AC #" (inc idx) " " verdict ": " (:task.ac/text ac))
         :payload {:index idx :verdict verdict :reasoning reasoning}}))
    {:ok? true :criterion {:text (:task.ac/text ac) :verdict verdict :reasoning reasoning}}))

(defn update-task-status
  "Advance a task to the next lifecycle status.

   Context: {:conn conn}
   Params:  {:task-id UUID-or-string
             :status \"implementing\"|\"testing\"|\"done\"}
   Returns: {:ok? true :task-id \"...\" :status \"...\"}"
  [{:keys [conn]} {:keys [task-id status]}]
  (let [id      (if (string? task-id) (UUID/fromString task-id) task-id)
        kw      (get status->keyword status)]
    (when-not kw
      (throw (ex-info (str "Unknown status: " status)
               {:status status :allowed (keys status->keyword)})))
    (let [updated (domain.task/update-status! conn id kw)]
      {:ok?     true
       :task-id (str (:task/id updated))
       :status  (name (:task/status updated))})))
