(ns comprehensive.db)

(defprotocol TicketStore
  (save-ticket! [this ticket])
  (find-ticket [this ticket-id])
  (list-tickets [this]))

(defrecord InMemoryStore [state]
  TicketStore
  (save-ticket! [_ ticket]
    (swap! state assoc (:id ticket) ticket)
    ticket)
  (find-ticket [_ ticket-id]
    (get @state ticket-id))
  (list-tickets [_]
    (-> @state vals vec)))

(defn make-store []
  (->InMemoryStore (atom {})))
