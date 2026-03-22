(ns com.blockether.styrmann.execution.tools.ticket
  "Tool functions for ticket operations."
  (:require
   [com.blockether.styrmann.db.ticket :as db.ticket]))

(defn find-ticket
  "Find ticket details by id.

   Context: {:conn conn}
   Input:   {:ticket-id uuid-string}
   Output:  Ticket map or {:error message}"
  [{:keys [conn]} {:keys [ticket-id]}]
  (let [id (if (string? ticket-id)
             (java.util.UUID/fromString ticket-id)
             ticket-id)]
    (if-let [ticket (db.ticket/find-ticket conn id)]
      {:ok? true
       :ticket (-> ticket
                   (select-keys [:ticket/id :ticket/title :ticket/description
                                 :ticket/type :ticket/status
                                 :ticket/acceptance-criteria-edn
                                 :ticket/story-points :ticket/effort :ticket/impact
                                 :ticket/assignee])
                   (update :ticket/id str)
                   (update :ticket/type name)
                   (update :ticket/status name))}
      {:ok? false
       :error (str "Ticket not found: " ticket-id)})))
