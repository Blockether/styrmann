(ns com.blockether.styrmann.execution.tools.system
  "System tools for emitting session events, recording deliverables, and
   advancing task status from within an RLM execution session."
  (:require
   [com.blockether.styrmann.execution.session :as session])
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

   Context: {:ctx ctx :session-id uuid}
   Params:  {:type \"string\" :message \"string\" :payload {...}}
   Returns: {:ok? true}"
  [{:keys [ctx session-id]} {:keys [type message payload]}]
  (session/record-session-event!
    ctx
    {:session-id session-id
     :type       (keyword "session.event.type" type)
     :message    (str message)
     :payload    payload})
  {:ok? true})

(defn record-deliverable
  "Record or update a deliverable on a task.

   Reads the current `:task/deliverables-edn` EDN vector, appends the new
   deliverable (keyed by title for idempotency), and persists it back.

   Context: {:ctx ctx}
   Params:  {:task-id UUID-or-string
             :title \"string\"
             :description \"string\"
             :status \"pending\"|\"done\"}
   Returns: {:ok? true :deliverables [...]}"
  [{:keys [ctx]} {:keys [task-id title description status]}]
  (let [id     (if (string? task-id) (UUID/fromString task-id) task-id)]
    (when-not (contains? allowed-deliverable-statuses status)
      (throw (ex-info (str "Invalid deliverable status: " status)
               {:status status :allowed allowed-deliverable-statuses})))
    ((:domain/record-deliverable! ctx) id title description status)))

(def ^:private ac-verdict->keyword
  {"verified" :ac.status/verified
   "failed"   :ac.status/failed
   "skipped"  :ac.status/skipped
   "pending"  :ac.status/pending})

(defn verify-acceptance-criterion
  "Mark an acceptance criterion as verified, failed, or skipped.

   Each AC is its own Datalevin entity (task.ac/*), so parallel calls are safe.
   Looks up the criterion by task-id + index, transacts verdict atomically.

   Context: {:ctx ctx :session-id uuid}
   Params:  {:task-id UUID-or-string
             :index int — 0-based AC index
             :verdict \"verified\"|\"failed\"|\"skipped\"
             :reasoning \"string explaining why\"}
   Returns: {:ok? true :criterion {...}}"
  [{:keys [ctx session-id]} {:keys [task-id index verdict reasoning]}]
  (let [id    (if (string? task-id) (UUID/fromString task-id) task-id)
        kw    (get ac-verdict->keyword verdict)
        _     (when-not kw
                (throw (ex-info (str "Invalid verdict: " verdict) {:allowed (keys ac-verdict->keyword)})))
        result ((:domain/verify-acceptance-criterion! ctx) id (long index) kw (str reasoning))]
    (when session-id
      (session/record-session-event!
        ctx
        {:session-id session-id
         :type :session.event.type/ac-verification
         :message (str "AC #" (inc (long index)) " " verdict ": " (:text result))
         :payload {:index index :verdict verdict :reasoning reasoning}}))
    {:ok? true :criterion {:text (:text result) :verdict verdict :reasoning reasoning}}))

(defn update-task-status
  "Advance a task to the next lifecycle status.

   Context: {:ctx ctx}
   Params:  {:task-id UUID-or-string
             :status \"implementing\"|\"testing\"|\"done\"}
   Returns: {:ok? true :task-id \"...\" :status \"...\"}"
  [{:keys [ctx]} {:keys [task-id status]}]
  (let [id      (if (string? task-id) (UUID/fromString task-id) task-id)
        kw      (get status->keyword status)]
    (when-not kw
      (throw (ex-info (str "Unknown status: " status)
               {:status status :allowed (keys status->keyword)})))
    (let [updated ((:domain/update-task-status! ctx) id kw)]
      {:ok?     true
       :task-id (str (:task/id updated))
       :status  (name (:task/status updated))})))
