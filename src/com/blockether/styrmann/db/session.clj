(ns com.blockether.styrmann.db.session
  "Datalevin persistence for execution environments, agents, workflows, and sessions."
  (:require
   [datalevin.core :as d])
  (:import
   [java.util UUID]))

(def ^:private environment-pull
  [:execution-environment/id
   :execution-environment/model
   :execution-environment/working-directory
   :execution-environment/status
   :execution-environment/created-at
   {:execution-environment/workspace [:workspace/id :workspace/name :workspace/repository {:workspace/organization [:organization/id :organization/name]}]}
   {:execution-environment/provider [:provider/id :provider/name :provider/base-url :provider/default?]}])

(def ^:private agent-pull
  [:agent/id :agent/key :agent/name :agent/type :agent/model :agent/version :agent/role :agent/instructions-edn :agent/created-at
   {:agent/tools [:tool-definition/id :tool-definition/key :tool-definition/name :tool-definition/fn-symbol :tool-definition/enabled?]}])

(def ^:private workflow-pull
  [:workflow/id
   :workflow/status
   :workflow/created-at
   :workflow/started-at
   :workflow/finished-at
   {:workflow/task [:task/id :task/description :task/status {:task/workspace [:workspace/id :workspace/name :workspace/repository]}]}])

(def ^:private session-pull
  [:session/id
   :session/status
   :session/pid
   :session/command-edn
   :session/log-path
   :session/exit-path
   :session/working-directory
   :session/started-at
   :session/finished-at
   :session/created-at
   {:session/workflow workflow-pull}
   {:session/environment environment-pull}
   {:session/agent agent-pull}])

(def ^:private tool-definition-pull
  [:tool-definition/id
   :tool-definition/key
   :tool-definition/name
   :tool-definition/description
   :tool-definition/input-schema-edn
   :tool-definition/fn-symbol
   :tool-definition/enabled?
   :tool-definition/created-at])

(def ^:private session-call-pull
  [:session.calls/id
   :session.calls/status
   :session.calls/input-edn
   :session.calls/output-edn
   :session.calls/error-message
   :session.calls/started-at
   :session.calls/finished-at
   :session.calls/created-at
   {:session.calls/session [:session/id]}
   {:session.calls/tool [:tool-definition/id :tool-definition/key :tool-definition/name]}])

(def ^:private session-event-pull
  [:session.event/id
   :session.event/type
   :session.event/message
   :session.event/payload-edn
   :session.event/created-at
   {:session.event/session [:session/id]}])

(defn find-session
  "Fetch a session by UUID."
  [conn session-id]
  (d/pull (d/db conn) session-pull [:session/id session-id]))

(defn list-sessions-by-task
  "List sessions for a task, newest first."
  [conn task-id]
  (->> (d/q '[:find ?session-id
              :in $ ?task-id
              :where
              [?task :task/id ?task-id]
              [?workflow :workflow/task ?task]
              [?session :session/workflow ?workflow]
              [?session :session/id ?session-id]]
            (d/db conn)
            task-id)
       (map first)
       (map #(find-session conn %))
       (sort-by :session/created-at #(compare %2 %1))
       vec))

(defn create-workflow!
  "Create workflow for a task."
  [conn {:keys [task-id]}]
  (let [workflow-id (UUID/randomUUID)]
    (d/transact! conn [(cond-> {:workflow/id         workflow-id
                                :workflow/status     :workflow.status/running
                                :workflow/created-at (java.util.Date.)
                                :workflow/started-at (java.util.Date.)}
                         task-id (assoc :workflow/task [:task/id task-id]))])
    (d/pull (d/db conn) workflow-pull [:workflow/id workflow-id])))

(defn mark-workflow-finished!
  "Mark workflow final status."
  [conn workflow-id status]
  (d/transact! conn [{:db/id                [:workflow/id workflow-id]
                      :workflow/status      status
                      :workflow/finished-at (java.util.Date.)}])
  (d/pull (d/db conn) workflow-pull [:workflow/id workflow-id]))

(defn find-environment-by-workspace
  "Find an execution environment by workspace UUID."
  [conn workspace-id]
  (when-let [environment-id
             (ffirst
              (d/q '[:find ?environment-id
                     :in $ ?workspace-id
                     :where
                     [?workspace :workspace/id ?workspace-id]
                     [?environment :execution-environment/workspace ?workspace]
                     [?environment :execution-environment/id ?environment-id]]
                   (d/db conn)
                   workspace-id))]
    (d/pull (d/db conn) environment-pull [:execution-environment/id environment-id])))

(defn list-environments-by-organization
  "List execution environments for all workspaces in an organization."
  [conn organization-id]
  (->> (d/q '[:find ?environment-id
              :in $ ?organization-id
              :where
              [?organization :organization/id ?organization-id]
              [?workspace :workspace/organization ?organization]
              [?environment :execution-environment/workspace ?workspace]
              [?environment :execution-environment/id ?environment-id]]
            (d/db conn)
            organization-id)
       (map first)
       (map #(d/pull (d/db conn) environment-pull [:execution-environment/id %]))
       (sort-by (fn [environment]
                  [(get-in environment [:execution-environment/workspace :workspace/name])
                   (:execution-environment/created-at environment)]))
       vec))

(defn create-environment!
  "Create an execution environment for a workspace."
  [conn {:keys [workspace-id provider-id model working-directory status]}]
  (let [environment-id (UUID/randomUUID)]
    (d/transact! conn [(cond-> {:execution-environment/id                environment-id
                                :execution-environment/workspace        [:workspace/id workspace-id]
                                :execution-environment/model             model
                                :execution-environment/working-directory working-directory
                                :execution-environment/status           status
                                :execution-environment/created-at        (java.util.Date.)}
                         provider-id (assoc :execution-environment/provider [:provider/id provider-id]))])
    (find-environment-by-workspace conn workspace-id)))

(defn update-environment-by-workspace!
  "Update an execution environment selected by workspace UUID."
  [conn workspace-id attrs]
  (if-let [environment (find-environment-by-workspace conn workspace-id)]
    (let [txn (cond-> {:db/id [:execution-environment/id (:execution-environment/id environment)]}
                (contains? attrs :provider-id)      (assoc :execution-environment/provider [:provider/id (:provider-id attrs)])
                (contains? attrs :model)            (assoc :execution-environment/model (:model attrs))
                (contains? attrs :working-directory) (assoc :execution-environment/working-directory (:working-directory attrs))
                (contains? attrs :status)           (assoc :execution-environment/status (:status attrs)))]
      (d/transact! conn [txn])
      (find-environment-by-workspace conn workspace-id))
    (create-environment!
     conn
     {:workspace-id workspace-id
      :provider-id (:provider-id attrs)
      :model (or (:model attrs) "gpt-4o-mini")
      :working-directory (:working-directory attrs)
      :status (or (:status attrs) :execution-environment.status/ready)})))

(defn find-agent-by-key
  "Find an agent definition by unique key."
  [conn agent-key]
  (d/pull (d/db conn) agent-pull [:agent/key agent-key]))

(defn find-agent-by-id
  "Find an agent by UUID."
  [conn agent-id]
  (d/pull (d/db conn) agent-pull [:agent/id agent-id]))

(defn create-agent!
  "Create an agent definition."
  [conn {:keys [key name type model version role instructions-edn tool-ids]}]
  (let [agent-id (UUID/randomUUID)]
    (d/transact! conn [(cond-> {:agent/id               agent-id
                                :agent/key              key
                                :agent/name             name
                                :agent/version          version
                                :agent/role             role
                                :agent/instructions-edn instructions-edn
                                :agent/created-at       (java.util.Date.)}
                         type (assoc :agent/type type)
                         model (assoc :agent/model model)
                         (seq tool-ids) (assoc :agent/tools (mapv (fn [tool-id] [:tool-definition/id tool-id]) tool-ids)))])
    (find-agent-by-key conn key)))

(defn update-agent-tools!
  "Replace the full tool set assigned to an agent."
  [conn agent-id tool-ids]
  (d/transact! conn [{:db/id [:agent/id agent-id]
                      :agent/tools (mapv (fn [tool-id] [:tool-definition/id tool-id]) tool-ids)}])
  (find-agent-by-id conn agent-id))

(defn find-tool-definition-by-key
  "Find a tool definition by key."
  [conn tool-key]
  (d/pull (d/db conn) tool-definition-pull [:tool-definition/key tool-key]))

(defn list-tool-definitions
  "List all tool definitions sorted by key."
  [conn]
  (->> (d/q '[:find ?tool-id
              :where
              [?tool :tool-definition/id ?tool-id]]
            (d/db conn))
       (map first)
       (map #(d/pull (d/db conn) tool-definition-pull [:tool-definition/id %]))
       (sort-by :tool-definition/key)
       vec))

(defn upsert-tool-definition!
  "Create or update a tool definition by key."
  [conn {:keys [key name description input-schema-edn fn-symbol enabled?]}]
  (if (find-tool-definition-by-key conn key)
    (do
      (d/transact! conn [{:db/id                            [:tool-definition/key key]
                          :tool-definition/name             name
                          :tool-definition/description      description
                          :tool-definition/input-schema-edn input-schema-edn
                          :tool-definition/fn-symbol        fn-symbol
                          :tool-definition/enabled?         enabled?}])
      (find-tool-definition-by-key conn key))
    (let [tool-id (UUID/randomUUID)]
      (d/transact! conn [{:tool-definition/id               tool-id
                          :tool-definition/key              key
                          :tool-definition/name             name
                          :tool-definition/description      description
                          :tool-definition/input-schema-edn input-schema-edn
                          :tool-definition/fn-symbol        fn-symbol
                          :tool-definition/enabled?         enabled?
                          :tool-definition/created-at       (java.util.Date.)}])
      (find-tool-definition-by-key conn key))))

(defn create-session!
  "Persist one agent session within a workflow."
  [conn {:keys [workflow-id environment-id agent-id pid command-edn log-path exit-path working-directory]}]
  (let [session-id (UUID/randomUUID)]
    (d/transact! conn [(cond-> {:session/id                session-id
                                :session/workflow          [:workflow/id workflow-id]
                                :session/environment       [:execution-environment/id environment-id]
                                :session/agent             [:agent/id agent-id]
                                :session/status            :session.status/running
                                :session/pid               pid
                                :session/command-edn       command-edn
                                :session/working-directory working-directory
                                :session/started-at        (java.util.Date.)
                                :session/created-at        (java.util.Date.)}
                         log-path (assoc :session/log-path log-path)
                         exit-path (assoc :session/exit-path exit-path))])
    (find-session conn session-id)))

(defn mark-session-finished!
  "Set final status and finished-at for a session."
  [conn session-id status]
  (d/transact! conn [{:db/id              [:session/id session-id]
                      :session/status      status
                      :session/finished-at (java.util.Date.)}])
  (find-session conn session-id))

(defn create-tool-call!
  "Persist a tool call start event."
  [conn {:keys [session-id tool-id input-edn]}]
  (let [tool-call-id (UUID/randomUUID)]
    (d/transact! conn [{:session.calls/id         tool-call-id
                        :session.calls/session    [:session/id session-id]
                        :session.calls/tool       [:tool-definition/id tool-id]
                        :session.calls/status     :session.calls.status/running
                        :session.calls/input-edn  input-edn
                        :session.calls/started-at (java.util.Date.)
                        :session.calls/created-at (java.util.Date.)}])
    (d/pull (d/db conn) session-call-pull [:session.calls/id tool-call-id])))

(defn finish-tool-call!
  "Mark a tool call as succeeded or failed."
  [conn tool-call-id {:keys [status output-edn error-message]}]
  (d/transact! conn [(cond-> {:db/id                     [:session.calls/id tool-call-id]
                              :session.calls/status      status
                              :session.calls/finished-at (java.util.Date.)}
                       output-edn (assoc :session.calls/output-edn output-edn)
                       error-message (assoc :session.calls/error-message error-message))])
  (d/pull (d/db conn) session-call-pull [:session.calls/id tool-call-id]))

(defn list-tool-calls-by-session
  "List tool calls for a session ordered by start time."
  [conn session-id]
  (->> (d/q '[:find ?tool-call-id
              :in $ ?session-id
              :where
              [?session :session/id ?session-id]
              [?tool-call :session.calls/session ?session]
              [?tool-call :session.calls/id ?tool-call-id]]
            (d/db conn)
            session-id)
       (map first)
       (map #(d/pull (d/db conn) session-call-pull [:session.calls/id %]))
       (sort-by :session.calls/started-at #(compare %1 %2))
       vec))

(defn create-session-event!
  "Persist an event emitted for a session."
  [conn {:keys [session-id type message payload-edn]}]
  (let [event-id (UUID/randomUUID)]
    (d/transact! conn [{:session.event/id         event-id
                        :session.event/session    [:session/id session-id]
                        :session.event/type       type
                        :session.event/message    message
                        :session.event/payload-edn payload-edn
                        :session.event/created-at (java.util.Date.)}])
    (d/pull (d/db conn) session-event-pull [:session.event/id event-id])))

(defn list-session-events
  "List events for a session ordered by creation time."
  [conn session-id]
  (->> (d/q '[:find ?event-id
              :in $ ?session-id
              :where
              [?session :session/id ?session-id]
              [?event :session.event/session ?session]
              [?event :session.event/id ?event-id]]
            (d/db conn)
            session-id)
       (map first)
       (map #(d/pull (d/db conn) session-event-pull [:session.event/id %]))
       (sort-by :session.event/created-at #(compare %1 %2))
       vec))

(defn create-session-message!
  "Persist a message exchanged during a session."
  [conn {:keys [session-id role content]}]
  (let [msg-id (UUID/randomUUID)]
    (d/transact! conn [{:session.messages/id      msg-id
                        :session.messages/session [:session/id session-id]
                        :session.messages/role    role
                        :session.messages/content content
                        :session.messages/created-at (java.util.Date.)}])
    msg-id))

(defn list-session-messages
  "List messages for a session ordered by creation time."
  [conn session-id]
  (->> (d/q '[:find [(pull ?m [:session.messages/id :session.messages/role
                                :session.messages/content :session.messages/created-at]) ...]
              :in $ ?sid
              :where [?s :session/id ?sid] [?m :session.messages/session ?s]]
            (d/db conn) session-id)
       (sort-by :session.messages/created-at)
       vec))
