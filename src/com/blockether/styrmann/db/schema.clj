(ns com.blockether.styrmann.db.schema
  "Datalevin schema for the Styrmann orchestration system.")

(def schema
  {;; -- Ticket ---------------------------------------------------------------
   :ticket/id          {:db/valueType :db.type/uuid
                        :db/unique    :db.unique/identity
                        :db/doc       "Unique ticket identifier"}
   :ticket/title       {:db/valueType :db.type/string
                        :db/doc       "Short title for the business ticket"}
   :ticket/description {:db/valueType :db.type/string
                        :db/doc       "Detailed description (optional)"}
   :ticket/status      {:db/valueType :db.type/keyword
                        :db/doc       "One of :ticket.status/backlog :ticket.status/active :ticket.status/done :ticket.status/cancelled"}
   :ticket/created-at  {:db/valueType :db.type/instant
                        :db/doc       "Creation timestamp"}
   :ticket/milestone   {:db/valueType :db.type/ref
                        :db/doc       "Ref to milestone (nil = backlog)"}

   ;; -- Milestone ------------------------------------------------------------
   :milestone/id          {:db/valueType :db.type/uuid
                           :db/unique    :db.unique/identity
                           :db/doc       "Unique milestone identifier"}
   :milestone/title       {:db/valueType :db.type/string
                           :db/doc       "Milestone title"}
   :milestone/description {:db/valueType :db.type/string
                           :db/doc       "Milestone description (optional)"}
   :milestone/sprint      {:db/valueType :db.type/ref
                           :db/doc       "Ref to sprint (nil = unassigned)"}
   :milestone/created-at  {:db/valueType :db.type/instant
                           :db/doc       "Creation timestamp"}

   ;; -- Sprint ---------------------------------------------------------------
   :sprint/id          {:db/valueType :db.type/uuid
                        :db/unique    :db.unique/identity
                        :db/doc       "Unique sprint identifier"}
   :sprint/title       {:db/valueType :db.type/string
                        :db/doc       "Sprint title"}
   :sprint/status      {:db/valueType :db.type/keyword
                        :db/doc       "One of :sprint.status/planning :sprint.status/active :sprint.status/completed"}
   :sprint/start-date  {:db/valueType :db.type/instant
                        :db/doc       "Sprint start date (optional)"}
   :sprint/end-date    {:db/valueType :db.type/instant
                        :db/doc       "Sprint end date (optional)"}
   :sprint/created-at  {:db/valueType :db.type/instant
                        :db/doc       "Creation timestamp"}})
