(ns com.blockether.styrmann.app
  "Ring app wiring for SSR screens and form actions."
  (:require
   [clojure.string :as str]
   [com.blockether.styrmann.db.organization :as db.organization]
   [com.blockether.styrmann.db.task :as db.task]
   [com.blockether.styrmann.domain.analysis :as analysis]
   [com.blockether.styrmann.util :as util]
   [com.blockether.styrmann.domain.organization :as organization]
   [com.blockether.styrmann.domain.planning :as planning]
   [com.blockether.styrmann.domain.provider :as provider]
   [com.blockether.styrmann.domain.task :as task]
   [com.blockether.styrmann.domain.ticket :as ticket]
   [com.blockether.styrmann.execution.session :as session]
   [taoensso.telemere :as t]
   [com.blockether.styrmann.presentation.component.layout :as layout]
   [com.blockether.styrmann.presentation.screen.home :as home-screen]
   [com.blockether.styrmann.presentation.screen.organization-settings :as organization-settings-screen]
   [com.blockether.styrmann.presentation.screen.organization-show :as organization-screen]
   [com.blockether.styrmann.presentation.screen.task-show :as task-screen]
   [com.blockether.styrmann.presentation.screen.ticket-show :as ticket-screen]
   [com.blockether.styrmann.presentation.screen.workspace-show :as workspace-screen]
   [ring.middleware.keyword-params :as keyword-params]
   [ring.middleware.multipart-params :as multipart-params]
   [ring.middleware.params :as params]
   [ring.middleware.resource :as resource]
   [ring.util.response :as response])
  (:import
   [java.util UUID]))

(def ^:private build-version
  "Unique version string for this build. Changes on every uberjar rebuild."
  (str (hash (System/getProperty "java.class.path")) "-" (.toEpochMilli (java.time.Instant/now))))

(defn- handle-version [_request]
  (-> (response/response build-version)
      (response/content-type "text/plain")))

(defn- html-response [body]
  (-> (response/response body)
      (response/content-type "text/html; charset=utf-8")))

(defn- redirect-to [path]
  (-> (response/redirect path :see-other)
      (assoc :body "")))

(defn- not-found-page [message]
  (-> (html-response (layout/page "Not found" (layout/panel (str "<p>" message "</p>"))))
      (response/status 404)))

(defn- uuid [value]
  (UUID/fromString (str value)))

(defn- parse-int [value]
  (parse-long (str value)))

(defn- keyword-from-param [value]
  (keyword (str value)))

(defn- uploads [params]
  (let [value (:attachments params)]
    (cond
      (nil? value) []
      (sequential? value) (vec value)
      :else [value])))

(defn- request-params [request]
  (->> (merge (:params request) (:multipart-params request))
       (map (fn [[key value]] [(if (keyword? key) key (keyword (str key))) value]))
       (into {})))

(declare handle-fragment-organization)

(defn- handle-home [conn _request]
  (if-let [organization (organization/default-organization conn)]
    (redirect-to (str "/organizations/" (:organization/id organization)))
    (html-response (home-screen/render conn))))

(defn- handle-create-organization [conn request]
  (let [organization (organization/create! conn {:name (get-in request [:params :name])})]
    (redirect-to (str "/organizations/" (:organization/id organization)))))

(defn- handle-organization-show [conn organization-id]
  (if (organization/overview conn organization-id)
    (html-response (organization-screen/render conn organization-id))
    (not-found-page "Organization not found.")))

(defn- handle-runner-models-fragment [conn request]
  (let [params (:query-params request)
        prefix (get params "prefix" "primary")
        provider-id-str (get params "provider-id")
        models (if (and provider-id-str (not= "" provider-id-str))
                 (let [p (provider/get-provider conn (java.util.UUID/fromString provider-id-str))]
                   (if p (provider/fetch-models p) []))
                 [])]
    (-> (response/response
         (str (layout/render-fragment
               (organization-settings-screen/render-model-select-fragment prefix models))
              "<script>lucide.createIcons();</script>"))
        (response/content-type "text/html; charset=utf-8"))))

(defn- handle-organization-settings [conn organization-id request]
  (if (organization/overview conn organization-id)
    (let [tab (case (get-in request [:query-params "tab"])
                "runner" :runner
                :providers)]
      (html-response (organization-settings-screen/render conn organization-id tab)))
    (not-found-page "Organization not found.")))

(defn- handle-update-runner-settings [conn organization-id request]
  (let [params (request-params request)
        workspace-id (uuid (:workspace-id params))]
    (session/configure-workspace-environment!
     conn
     {:workspace-id workspace-id
      :provider-id (some-> (:provider-id params) uuid)
      :model (:model params)
      :working-directory (:working-directory params)
      :status (keyword-from-param (:status params))})
    (redirect-to (str "/organizations/" organization-id "/settings?tab=runner"))))

(defn- handle-add-provider [conn organization-id request]
  (let [params (request-params request)]
    (provider/add-provider!
     conn
     {:name (:name params)
      :base-url (:base-url params)
      :api-key (:api-key params)
      :default? (= (:default? params) "true")})
    (redirect-to (str "/organizations/" organization-id "/settings?tab=providers"))))

(defn- handle-create-workspace [conn organization-id request]
  (organization/create-workspace!
   conn
   {:organization-id organization-id
    :name            (get-in request [:params :name])
    :repository      (get-in request [:params :repository])})
  (redirect-to (str "/organizations/" organization-id)))

(defn- handle-create-sprint [conn organization-id request]
  (planning/create-sprint!
   conn
   {:organization-id organization-id
    :name            (get-in request [:params :name])})
  (redirect-to (str "/organizations/" organization-id)))

(defn- handle-create-milestone [conn organization-id request]
  (let [params (request-params request)]
    (planning/create-milestone!
     conn
     {:sprint-id (uuid (:sprint-id params))
      :name      (:name params)})
    (redirect-to (str "/organizations/" organization-id))))

(defn- handle-create-ticket [conn organization-id request]
  (let [params (request-params request)
        ticket (ticket/create!
                conn
                {:organization-id          organization-id
                 :type                     (keyword-from-param (:type params))
                 :title                    (:title params)
                 :description              (:description params)
                 :acceptance-criteria-text (:acceptance-criteria-text params)
                 :story-points             (parse-int (:story-points params))
                 :effort                   (parse-int (:effort params))
                 :impact                   (parse-int (:impact params))
                 :assignee                 (:assignee params)
                 :attachments              (uploads params)})]
    (redirect-to (str "/organizations/" organization-id "/tickets/" (:ticket/id ticket)))))

(defn- handle-ticket-show [conn ticket-id]
  (if (ticket/find-by-id conn ticket-id)
    (html-response (ticket-screen/render conn ticket-id))
    (not-found-page "Ticket not found.")))

(defn- handle-ticket-show-in-organization [conn organization-id ticket-id]
  (if-let [ticket-record (ticket/find-by-id conn ticket-id)]
    (if (= organization-id (get-in ticket-record [:ticket/organization :organization/id]))
      (html-response (ticket-screen/render conn ticket-id))
      (not-found-page "Ticket not found in organization."))
    (not-found-page "Ticket not found.")))

(defn- handle-ticket-status [conn organization-id ticket-id request]
  (let [status (keyword-from-param (get-in request [:params :status]))]
    (ticket/update-status! conn ticket-id status)
    (if (= "fetch" (get-in request [:headers "x-requested-with"]))
      (-> (response/response "")
          (response/status 204))
      (redirect-to (str "/organizations/" organization-id "/tickets/" ticket-id)))))

(defn- handle-ticket-assign-sprint [conn ticket-id request]
  (if-let [ticket-record (ticket/find-by-id conn ticket-id)]
    (let [organization-id (get-in ticket-record [:ticket/organization :organization/id])]
      (planning/assign-ticket-to-sprint!
       conn
       {:ticket-id ticket-id
        :sprint-id (uuid (get-in request [:params :sprint-id]))})
      (redirect-to (str "/organizations/" organization-id "/tickets/" ticket-id)))
    (not-found-page "Ticket not found.")))

(defn- handle-ticket-assign-milestone [conn ticket-id request]
  (if-let [ticket-record (ticket/find-by-id conn ticket-id)]
    (let [organization-id (get-in ticket-record [:ticket/organization :organization/id])]
      (planning/assign-ticket-to-milestone!
       conn
       {:ticket-id    ticket-id
        :milestone-id (uuid (get-in request [:params :milestone-id]))})
      (redirect-to (str "/organizations/" organization-id "/tickets/" ticket-id)))
    (not-found-page "Ticket not found.")))

(defn- handle-create-task [conn ticket-id request]
  (if-let [ticket-record (ticket/find-by-id conn ticket-id)]
    (let [organization-id (get-in ticket-record [:ticket/organization :organization/id])
          created-task (task/create!
                        conn
                        {:ticket-id    ticket-id
                         :workspace-id (uuid (get-in request [:params :workspace-id]))
                         :description  (get-in request [:params :description])})]
      (redirect-to (str "/organizations/" organization-id "/tasks/" (:task/id created-task))))
    (not-found-page "Ticket not found.")))

(defn- handle-workspace-show [conn workspace-id]
  (if-let [_workspace (db.organization/find-workspace conn workspace-id)]
    (html-response (workspace-screen/render conn workspace-id))
    (not-found-page "Workspace not found.")))

(defn- handle-workspace-show-in-organization [conn organization-id workspace-id]
  (if-let [workspace (db.organization/find-workspace conn workspace-id)]
    (if (= organization-id (get-in workspace [:workspace/organization :organization/id]))
      (html-response (workspace-screen/render conn workspace-id))
      (not-found-page "Workspace not found in organization."))
    (not-found-page "Workspace not found.")))

(defn- handle-task-show [conn task-id]
  (if (db.task/find-task conn task-id)
    (html-response (task-screen/render conn task-id))
    (not-found-page "Task not found.")))

(defn- handle-task-show-in-organization [conn organization-id task-id]
  (if-let [task-record (db.task/find-task conn task-id)]
    (if (= organization-id (get-in task-record [:task/ticket :ticket/organization :organization/id]))
      (html-response (task-screen/render conn task-id))
      (not-found-page "Task not found in organization."))
    (not-found-page "Task not found.")))

(defn- handle-task-status [conn task-id request]
  (if-let [task-record (db.task/find-task conn task-id)]
    (let [organization-id (get-in task-record [:task/ticket :ticket/organization :organization/id])]
      (task/update-status! conn task-id (keyword-from-param (get-in request [:params :status])))
      (redirect-to (str "/organizations/" organization-id "/tasks/" task-id)))
    (not-found-page "Task not found.")))

(defn- handle-task-run [conn task-id]
  (if-let [task-record (db.task/find-task conn task-id)]
    (let [organization-id (get-in task-record [:task/ticket :ticket/organization :organization/id])]
      ;; Reset to inbox for retry via state machine
      (when-not (= :task.status/inbox (:task/status task-record))
        (task/update-status! conn task-id :task.status/inbox))
      (session/execute-with-rlm! conn task-id)
      (redirect-to (str "/organizations/" organization-id "/tasks/" task-id)))
    (not-found-page "Task not found.")))

(defn- handle-ticket-decompose [conn ticket-id]
  (if-let [t (ticket/find-by-id conn ticket-id)]
    (let [org-id  (get-in t [:ticket/organization :organization/id])
          result  (util/attempt #(analysis/decompose-ticket! conn ticket-id))]
      (if (:ok result)
        (redirect-to (str "/organizations/" org-id "/tickets/" ticket-id))
        (let [ex (:error result)]
          (t/log! :error ["Decompose failed" {:ticket-id ticket-id :error (ex-message ex)}])
          (-> (response/response
               (str "<div id=\"decompose-status\" class=\"card p-4 mt-3 border-l-4\" style=\"border-color: var(--danger);\">"
                    "<div class=\"text-[13px] text-[var(--danger)]\">" (ex-message ex) "</div></div>"))
              (response/content-type "text/html; charset=utf-8")))))
    (not-found-page "Ticket not found.")))

(defn- handoff-async!
  "Run decompose + execute pipeline for a ticket in the background."
  [conn ticket-id]
  (let [result (util/attempt
                #(do
                   (when (empty? (db.task/list-tasks-by-ticket conn ticket-id))
                     (analysis/decompose-ticket! conn ticket-id))
                   (ticket/update-status! conn ticket-id :ticket.status/in-progress)
                   (let [tasks      (db.task/list-tasks-by-ticket conn ticket-id)
                         root-tasks (filter (fn [t] (empty? (:task/depends-on t))) tasks)]
                     (doseq [root-task root-tasks]
                       (when (= :task.status/inbox (:task/status root-task))
                         (future (session/execute-with-rlm! conn (:task/id root-task))))))))]
    (when-let [ex (:error result)]
      (t/log! :error ["Handoff failed" {:ticket-id ticket-id :error (ex-message ex)}]))))

(defn- handle-ticket-handoff [conn ticket-id]
  (if-let [t (ticket/find-by-id conn ticket-id)]
    (let [org-id (get-in t [:ticket/organization :organization/id])]
      (future (handoff-async! conn ticket-id))
      (redirect-to (str "/organizations/" org-id "/tickets/" ticket-id)))
    (not-found-page "Ticket not found.")))

(defn- fragment-response
  "Create an HTML response with main content and OOB swaps for breadcrumbs/topbar."
  [_request {:keys [body-html breadcrumbs topbar-context]}]
  (-> (response/response
       (str (layout/render-fragment body-html)
            (layout/render-breadcrumb-fragment breadcrumbs true)
            (layout/render-topbar-context-fragment topbar-context true)
            "<script>lucide.createIcons();window.styrmannInitInteractive&&window.styrmannInitInteractive();</script>"))
      (response/content-type "text/html; charset=utf-8")))

(defn- handle-fragment-home [conn request]
  (if-let [organization (organization/default-organization conn)]
    (handle-fragment-organization conn request (:organization/id organization))
    (fragment-response request (home-screen/render-body conn))))

(defn- handle-fragment-organization [conn request organization-id]
  (if-let [fragment (organization-screen/render-body conn organization-id)]
    (fragment-response request fragment)
    (fragment-response request
                       {:body-html "<p>Organization not found.</p>"
                        :breadcrumbs []
                        :topbar-context ""})))

(defn- handle-attachment [conn attachment-id]
  (if-let [attachment (ticket/find-attachment conn attachment-id)]
    (-> (response/response (:attachment/data attachment))
        (response/content-type (:attachment/content-type attachment))
        (response/header "Content-Disposition" (str "inline; filename=\"" (:attachment/name attachment) "\"")))
    (not-found-page "Attachment not found.")))

(defn- handle-task-runs-fragment [conn task-id]
  (if-let [{:keys [html]} (task-screen/render-runs-fragment conn task-id)]
    (-> (response/response
         (str (layout/render-fragment html)
              "<script>lucide.createIcons();</script>"))
        (response/content-type "text/html; charset=utf-8"))
    (not-found-page "Task not found.")))

(defn handler
  "Handle HTTP requests for the Styrmann SSR app.

   Params:
   `conn` - Datalevin connection.
   `request` - Ring request map.

   Returns:
   Ring response map."
  [conn request]
  (let [method (:request-method request)
        uri (:uri request)
        segments (vec (remove str/blank? (str/split uri #"/")))]
    (let [result (util/attempt
                  #(cond
                     ;; API
                     (and (= method :get) (= segments ["api" "version"]))
                     (handle-version request)

        ;; Fragment routes (htmx)
        (and (= method :get) (= segments ["fragments" "home"]))
        (handle-fragment-home conn request)

        (and (= method :get) (= 3 (count segments)) (= "fragments" (first segments)) (= "organizations" (second segments)))
        (handle-fragment-organization conn request (uuid (nth segments 2)))

        (and (= method :get) (= 4 (count segments)) (= "fragments" (first segments)) (= "tasks" (second segments)) (= "runs" (nth segments 3)))
        (handle-task-runs-fragment conn (uuid (nth segments 2)))

        ;; Full page routes
        (and (= method :get) (empty? segments))
        (handle-home conn request)

        (and (= method :post) (= segments ["organizations"]))
        (handle-create-organization conn request)

        (and (= method :get) (= 2 (count segments)) (= "organizations" (first segments)))
        (handle-organization-show conn (uuid (second segments)))

        (and (= method :get) (= 3 (count segments)) (= "organizations" (first segments)) (= "settings" (nth segments 2)))
        (handle-organization-settings conn (uuid (second segments)) request)

        (and (= method :post) (= 3 (count segments)) (= "organizations" (first segments)) (= "workspaces" (nth segments 2)))
        (handle-create-workspace conn (uuid (second segments)) request)

        (and (= method :get) (= 4 (count segments)) (= "organizations" (first segments)) (= "settings" (nth segments 2)) (= "runner-models" (nth segments 3)))
        (handle-runner-models-fragment conn request)

        (and (= method :post) (= 4 (count segments)) (= "organizations" (first segments)) (= "settings" (nth segments 2)) (= "runner" (nth segments 3)))
        (handle-update-runner-settings conn (uuid (second segments)) request)

        (and (= method :post) (= 4 (count segments)) (= "organizations" (first segments)) (= "settings" (nth segments 2)) (= "provider" (nth segments 3)))
        (handle-add-provider conn (uuid (second segments)) request)

        (and (= method :post) (= 3 (count segments)) (= "organizations" (first segments)) (= "sprints" (nth segments 2)))
        (handle-create-sprint conn (uuid (second segments)) request)

        (and (= method :post) (= 3 (count segments)) (= "organizations" (first segments)) (= "milestones" (nth segments 2)))
        (handle-create-milestone conn (uuid (second segments)) request)

        (and (= method :post) (= 3 (count segments)) (= "organizations" (first segments)) (= "tickets" (nth segments 2)))
        (handle-create-ticket conn (uuid (second segments)) request)

        (and (= method :get) (= 4 (count segments)) (= "organizations" (first segments)) (= "tickets" (nth segments 2)))
        (handle-ticket-show-in-organization conn (uuid (second segments)) (uuid (nth segments 3)))

        (and (= method :post) (= 5 (count segments)) (= "organizations" (first segments)) (= "tickets" (nth segments 2)) (= "status" (nth segments 4)))
        (handle-ticket-status conn (uuid (second segments)) (uuid (nth segments 3)) request)

        (and (= method :post) (= 5 (count segments)) (= "organizations" (first segments)) (= "tickets" (nth segments 2)) (= "assign-sprint" (nth segments 4)))
        (handle-ticket-assign-sprint conn (uuid (nth segments 3)) request)

        (and (= method :post) (= 5 (count segments)) (= "organizations" (first segments)) (= "tickets" (nth segments 2)) (= "assign-milestone" (nth segments 4)))
        (handle-ticket-assign-milestone conn (uuid (nth segments 3)) request)

        (and (= method :post) (= 5 (count segments)) (= "organizations" (first segments)) (= "tickets" (nth segments 2)) (= "tasks" (nth segments 4)))
        (handle-create-task conn (uuid (nth segments 3)) request)

        (and (= method :get) (= 5 (count segments)) (= "organizations" (first segments)) (= "tickets" (nth segments 2)) (= "decompose" (nth segments 4)))
        (handle-ticket-decompose conn (uuid (nth segments 3)))

        (and (= method :post) (= 5 (count segments)) (= "organizations" (first segments)) (= "tickets" (nth segments 2)) (= "handoff" (nth segments 4)))
        (handle-ticket-handoff conn (uuid (nth segments 3)))

        (and (= method :get) (= 4 (count segments)) (= "organizations" (first segments)) (= "workspaces" (nth segments 2)))
        (handle-workspace-show-in-organization conn (uuid (second segments)) (uuid (nth segments 3)))

        (and (= method :get) (= 4 (count segments)) (= "organizations" (first segments)) (= "tasks" (nth segments 2)))
        (handle-task-show-in-organization conn (uuid (second segments)) (uuid (nth segments 3)))

        (and (= method :post) (= 5 (count segments)) (= "organizations" (first segments)) (= "tasks" (nth segments 2)) (= "status" (nth segments 4)))
        (handle-task-status conn (uuid (nth segments 3)) request)

        (and (= method :post) (= 5 (count segments)) (= "organizations" (first segments)) (= "tasks" (nth segments 2)) (= "runs" (nth segments 4)))
        (handle-task-run conn (uuid (nth segments 3)))

        (and (= method :get) (= 2 (count segments)) (= "tickets" (first segments)))
        (handle-ticket-show conn (uuid (second segments)))

        (and (= method :post) (= 3 (count segments)) (= "tickets" (first segments)) (= "assign-sprint" (nth segments 2)))
        (handle-ticket-assign-sprint conn (uuid (second segments)) request)

        (and (= method :post) (= 3 (count segments)) (= "tickets" (first segments)) (= "assign-milestone" (nth segments 2)))
        (handle-ticket-assign-milestone conn (uuid (second segments)) request)

        (and (= method :post) (= 3 (count segments)) (= "tickets" (first segments)) (= "tasks" (nth segments 2)))
        (handle-create-task conn (uuid (second segments)) request)

        (and (= method :get) (= 2 (count segments)) (= "workspaces" (first segments)))
        (handle-workspace-show conn (uuid (second segments)))

        (and (= method :get) (= 2 (count segments)) (= "tasks" (first segments)))
        (handle-task-show conn (uuid (second segments)))

        (and (= method :post) (= 3 (count segments)) (= "tasks" (first segments)) (= "status" (nth segments 2)))
        (handle-task-status conn (uuid (second segments)) request)

        (and (= method :post) (= 3 (count segments)) (= "tasks" (first segments)) (= "runs" (nth segments 2)))
        (handle-task-run conn (uuid (second segments)))

        (and (= method :get) (= 2 (count segments)) (= "attachments" (first segments)))
        (handle-attachment conn (uuid (second segments)))

        :else
        (not-found-page "Page not found.")))]
      (if-let [ex (:error result)]
        (-> (html-response (layout/page "Error" (layout/panel [:p (ex-message ex)])))
            (response/status 400))
        (:ok result)))))

(defn make-app
  "Build the Ring app with the given Datalevin connection.

   Params:
   `conn` - Datalevin connection.

   Returns:
   Ring handler."
  [conn]
  (-> (fn [request] (handler conn request))
      multipart-params/wrap-multipart-params
      keyword-params/wrap-keyword-params
      params/wrap-params
      (resource/wrap-resource "public")))
