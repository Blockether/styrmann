(ns com.blockether.styrmann.domain.tools.task
  "Tool functions for task operations."
  (:require
   [com.blockether.styrmann.db.task :as db.task]))

(defn list-by-ticket
  "List tasks for a ticket.

   Context: {:conn conn}
   Input:   {:ticket-id uuid-string}
   Output:  {:ok? true :tasks [...] :count n}"
  [{:keys [conn]} {:keys [ticket-id]}]
  (let [id (if (string? ticket-id)
             (java.util.UUID/fromString ticket-id)
             ticket-id)
        tasks (db.task/list-tasks-by-ticket conn id)]
    {:ok? true
     :count (count tasks)
     :tasks (mapv (fn [t]
                    (-> t
                        (select-keys [:task/id :task/description :task/status
                                      :task/acceptance-criteria-edn
                                      :task/cove-questions-edn])
                        (update :task/id str)
                        (update :task/status name)))
                  tasks)}))
