(ns com.blockether.styrmann.app
  "Ring app wiring for SSR screens and form actions."
  (:require
   [clojure.string :as str]
   [com.blockether.styrmann.db.core :as db]
   [com.blockether.styrmann.db.organization :as db.organization]
   [com.blockether.styrmann.db.task :as db.task]
   [com.blockether.styrmann.domain.organization :as organization]
   [com.blockether.styrmann.domain.planning :as planning]
   [com.blockether.styrmann.domain.provider :as provider]
   [com.blockether.styrmann.domain.task :as task]
   [com.blockether.styrmann.domain.ticket :as ticket]
   [com.blockether.styrmann.execution.session :as session]
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
   [ring.util.response :as response]
   [starfederation.datastar.clojure.adapter.ring :as ds-ring]
   [starfederation.datastar.clojure.api :as d*])
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

(defn- handle-home [_request]
  (if-let [organization (organization/default-organization (db/conn))]
    (redirect-to (str "/organizations/" (:organization/id organization)))
    (html-response (home-screen/render (db/conn)))))

(defn- handle-create-organization [request]
  (let [organization (organization/create! (db/conn) {:name (get-in request [:params :name])})]
    (redirect-to (str "/organizations/" (:organization/id organization)))))

(defn- handle-organization-show [organization-id]
  (if (organization/overview (db/conn) organization-id)
    (html-response (organization-screen/render (db/conn) organization-id))
    (not-found-page "Organization not found.")))

(defn- handle-organization-settings [organization-id request]
  (if (organization/overview (db/conn) organization-id)
    (let [tab (case (get-in request [:query-params "tab"])
                "runner" :runner
                :providers)]
      (html-response (organization-settings-screen/render (db/conn) organization-id tab)))
    (not-found-page "Organization not found.")))

(defn- handle-update-runner-settings [organization-id request]
  (let [params (request-params request)
        workspace-id (uuid (:workspace-id params))]
    (session/configure-workspace-environment!
     (db/conn)
     {:workspace-id workspace-id
      :provider-id (some-> (:provider-id params) uuid)
      :model (:model params)
      :working-directory (:working-directory params)
      :status (keyword-from-param (:status params))})
    (redirect-to (str "/organizations/" organization-id "/settings?tab=runner"))))

(defn- handle-add-provider [organization-id request]
  (let [params (request-params request)]
    (provider/add-provider!
     (db/conn)
     {:name (:name params)
      :base-url (:base-url params)
      :api-key (:api-key params)
      :default? (= (:default? params) "true")})
    (redirect-to (str "/organizations/" organization-id "/settings?tab=providers"))))

(defn- handle-create-workspace [organization-id request]
  (organization/create-workspace!
   (db/conn)
   {:organization-id organization-id
    :name            (get-in request [:params :name])
    :repository      (get-in request [:params :repository])})
  (redirect-to (str "/organizations/" organization-id)))

(defn- handle-create-sprint [organization-id request]
  (planning/create-sprint!
   (db/conn)
   {:organization-id organization-id
    :name            (get-in request [:params :name])})
  (redirect-to (str "/organizations/" organization-id)))

(defn- handle-create-milestone [organization-id request]
  (let [params (request-params request)]
    (planning/create-milestone!
     (db/conn)
     {:sprint-id (uuid (:sprint-id params))
      :name      (:name params)})
    (redirect-to (str "/organizations/" organization-id))))

(defn- handle-create-ticket [organization-id request]
  (let [params (request-params request)
        ticket (ticket/create!
                (db/conn)
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

(defn- handle-ticket-show [ticket-id]
  (if (ticket/find-by-id (db/conn) ticket-id)
    (html-response (ticket-screen/render (db/conn) ticket-id))
    (not-found-page "Ticket not found.")))

(defn- handle-ticket-show-in-organization [organization-id ticket-id]
  (if-let [ticket-record (ticket/find-by-id (db/conn) ticket-id)]
    (if (= organization-id (get-in ticket-record [:ticket/organization :organization/id]))
      (html-response (ticket-screen/render (db/conn) ticket-id))
      (not-found-page "Ticket not found in organization."))
    (not-found-page "Ticket not found.")))

(defn- handle-ticket-status [organization-id ticket-id request]
  (let [status (keyword-from-param (get-in request [:params :status]))]
    (ticket/update-status! (db/conn) ticket-id status)
    (if (= "fetch" (get-in request [:headers "x-requested-with"]))
      (-> (response/response "")
          (response/status 204))
      (redirect-to (str "/organizations/" organization-id "/tickets/" ticket-id)))))

(defn- handle-ticket-assign-sprint [ticket-id request]
  (if-let [ticket-record (ticket/find-by-id (db/conn) ticket-id)]
    (let [organization-id (get-in ticket-record [:ticket/organization :organization/id])]
      (planning/assign-ticket-to-sprint!
       (db/conn)
       {:ticket-id ticket-id
        :sprint-id (uuid (get-in request [:params :sprint-id]))})
      (redirect-to (str "/organizations/" organization-id "/tickets/" ticket-id)))
    (not-found-page "Ticket not found.")))

(defn- handle-ticket-assign-milestone [ticket-id request]
  (if-let [ticket-record (ticket/find-by-id (db/conn) ticket-id)]
    (let [organization-id (get-in ticket-record [:ticket/organization :organization/id])]
      (planning/assign-ticket-to-milestone!
       (db/conn)
       {:ticket-id    ticket-id
        :milestone-id (uuid (get-in request [:params :milestone-id]))})
      (redirect-to (str "/organizations/" organization-id "/tickets/" ticket-id)))
    (not-found-page "Ticket not found.")))

(defn- handle-create-task [ticket-id request]
  (if-let [ticket-record (ticket/find-by-id (db/conn) ticket-id)]
    (let [organization-id (get-in ticket-record [:ticket/organization :organization/id])
          created-task (task/create!
                        (db/conn)
                        {:ticket-id    ticket-id
                         :workspace-id (uuid (get-in request [:params :workspace-id]))
                         :description  (get-in request [:params :description])})]
      (redirect-to (str "/organizations/" organization-id "/tasks/" (:task/id created-task))))
    (not-found-page "Ticket not found.")))

(defn- handle-workspace-show [workspace-id]
  (if-let [_workspace (db.organization/find-workspace (db/conn) workspace-id)]
    (html-response (workspace-screen/render (db/conn) workspace-id))
    (not-found-page "Workspace not found.")))

(defn- handle-workspace-show-in-organization [organization-id workspace-id]
  (if-let [workspace (db.organization/find-workspace (db/conn) workspace-id)]
    (if (= organization-id (get-in workspace [:workspace/organization :organization/id]))
      (html-response (workspace-screen/render (db/conn) workspace-id))
      (not-found-page "Workspace not found in organization."))
    (not-found-page "Workspace not found.")))

(defn- handle-task-show [task-id]
  (if (db.task/find-task (db/conn) task-id)
    (html-response (task-screen/render (db/conn) task-id))
    (not-found-page "Task not found.")))

(defn- handle-task-show-in-organization [organization-id task-id]
  (if-let [task-record (db.task/find-task (db/conn) task-id)]
    (if (= organization-id (get-in task-record [:task/ticket :ticket/organization :organization/id]))
      (html-response (task-screen/render (db/conn) task-id))
      (not-found-page "Task not found in organization."))
    (not-found-page "Task not found.")))

(defn- handle-task-status [task-id request]
  (if-let [task-record (db.task/find-task (db/conn) task-id)]
    (let [organization-id (get-in task-record [:task/ticket :ticket/organization :organization/id])]
      (task/update-status! (db/conn) task-id (keyword-from-param (get-in request [:params :status])))
      (redirect-to (str "/organizations/" organization-id "/tasks/" task-id)))
    (not-found-page "Task not found.")))

(defn- handle-task-run [task-id]
  (if-let [task-record (db.task/find-task (db/conn) task-id)]
    (let [organization-id (get-in task-record [:task/ticket :ticket/organization :organization/id])]
      (session/execute! (db/conn) {:task-id task-id})
      (redirect-to (str "/organizations/" organization-id "/tasks/" task-id)))
    (not-found-page "Task not found.")))

(defn- sse-fragment-response
  "Create an SSE response that patches #main-content, #breadcrumbs, and #topbar-context."
  [request {:keys [body-html breadcrumbs topbar-context]}]
  (ds-ring/->sse-response request
                          {ds-ring/on-open
                           (fn [sse]
                             (d*/with-open-sse sse
                               (d*/patch-elements! sse body-html
                                                   {d*/selector "#main-content"
                                                    d*/patch-mode d*/pm-inner})
                               (d*/patch-elements! sse
                                                   (layout/render-breadcrumb-fragment breadcrumbs))
                               (d*/patch-elements! sse
                                                   (layout/render-topbar-context-fragment topbar-context))
                               (d*/execute-script! sse "lucide.createIcons();window.styrmannInitInteractive&&window.styrmannInitInteractive();")))}))

(defn- handle-fragment-home [request]
  (if-let [organization (organization/default-organization (db/conn))]
    (handle-fragment-organization request (:organization/id organization))
    (sse-fragment-response request (home-screen/render-body (db/conn)))))

(defn- handle-fragment-organization [request organization-id]
  (if-let [fragment (organization-screen/render-body (db/conn) organization-id)]
    (sse-fragment-response request fragment)
    (sse-fragment-response request
                           {:body-html "<p>Organization not found.</p>"
                            :breadcrumbs []
                            :topbar-context ""})))

(defn- handle-attachment [attachment-id]
  (if-let [attachment (ticket/find-attachment (db/conn) attachment-id)]
    (-> (response/response (:attachment/data attachment))
        (response/content-type (:attachment/content-type attachment))
        (response/header "Content-Disposition" (str "inline; filename=\"" (:attachment/name attachment) "\"")))
    (not-found-page "Attachment not found.")))

(defn handler
  "Handle HTTP requests for the Styrmann SSR app.

   Params:
   `request` - Ring request map.

   Returns:
   Ring response map."
  [request]
  (let [method (:request-method request)
        uri (:uri request)
        segments (vec (remove str/blank? (str/split uri #"/")))]
    (try
      (cond
        ;; API
        (and (= method :get) (= segments ["api" "version"]))
        (handle-version request)

        ;; SSE fragment routes (Datastar)
        (and (= method :get) (= segments ["fragments" "home"]))
        (handle-fragment-home request)

        (and (= method :get) (= 3 (count segments)) (= "fragments" (first segments)) (= "organizations" (second segments)))
        (handle-fragment-organization request (uuid (nth segments 2)))

        ;; Full page routes
        (and (= method :get) (empty? segments))
        (handle-home request)

        (and (= method :post) (= segments ["organizations"]))
        (handle-create-organization request)

        (and (= method :get) (= 2 (count segments)) (= "organizations" (first segments)))
        (handle-organization-show (uuid (second segments)))

        (and (= method :get) (= 3 (count segments)) (= "organizations" (first segments)) (= "settings" (nth segments 2)))
        (handle-organization-settings (uuid (second segments)) request)

        (and (= method :post) (= 3 (count segments)) (= "organizations" (first segments)) (= "workspaces" (nth segments 2)))
        (handle-create-workspace (uuid (second segments)) request)

        (and (= method :post) (= 4 (count segments)) (= "organizations" (first segments)) (= "settings" (nth segments 2)) (= "runner" (nth segments 3)))
        (handle-update-runner-settings (uuid (second segments)) request)

        (and (= method :post) (= 4 (count segments)) (= "organizations" (first segments)) (= "settings" (nth segments 2)) (= "provider" (nth segments 3)))
        (handle-add-provider (uuid (second segments)) request)

        (and (= method :post) (= 3 (count segments)) (= "organizations" (first segments)) (= "sprints" (nth segments 2)))
        (handle-create-sprint (uuid (second segments)) request)

        (and (= method :post) (= 3 (count segments)) (= "organizations" (first segments)) (= "milestones" (nth segments 2)))
        (handle-create-milestone (uuid (second segments)) request)

        (and (= method :post) (= 3 (count segments)) (= "organizations" (first segments)) (= "tickets" (nth segments 2)))
        (handle-create-ticket (uuid (second segments)) request)

        (and (= method :get) (= 4 (count segments)) (= "organizations" (first segments)) (= "tickets" (nth segments 2)))
        (handle-ticket-show-in-organization (uuid (second segments)) (uuid (nth segments 3)))

        (and (= method :post) (= 5 (count segments)) (= "organizations" (first segments)) (= "tickets" (nth segments 2)) (= "status" (nth segments 4)))
        (handle-ticket-status (uuid (second segments)) (uuid (nth segments 3)) request)

        (and (= method :post) (= 5 (count segments)) (= "organizations" (first segments)) (= "tickets" (nth segments 2)) (= "assign-sprint" (nth segments 4)))
        (handle-ticket-assign-sprint (uuid (nth segments 3)) request)

        (and (= method :post) (= 5 (count segments)) (= "organizations" (first segments)) (= "tickets" (nth segments 2)) (= "assign-milestone" (nth segments 4)))
        (handle-ticket-assign-milestone (uuid (nth segments 3)) request)

        (and (= method :post) (= 5 (count segments)) (= "organizations" (first segments)) (= "tickets" (nth segments 2)) (= "tasks" (nth segments 4)))
        (handle-create-task (uuid (nth segments 3)) request)

        (and (= method :get) (= 4 (count segments)) (= "organizations" (first segments)) (= "workspaces" (nth segments 2)))
        (handle-workspace-show-in-organization (uuid (second segments)) (uuid (nth segments 3)))

        (and (= method :get) (= 4 (count segments)) (= "organizations" (first segments)) (= "tasks" (nth segments 2)))
        (handle-task-show-in-organization (uuid (second segments)) (uuid (nth segments 3)))

        (and (= method :post) (= 5 (count segments)) (= "organizations" (first segments)) (= "tasks" (nth segments 2)) (= "status" (nth segments 4)))
        (handle-task-status (uuid (nth segments 3)) request)

        (and (= method :post) (= 5 (count segments)) (= "organizations" (first segments)) (= "tasks" (nth segments 2)) (= "runs" (nth segments 4)))
        (handle-task-run (uuid (nth segments 3)))

        (and (= method :get) (= 2 (count segments)) (= "tickets" (first segments)))
        (handle-ticket-show (uuid (second segments)))

        (and (= method :post) (= 3 (count segments)) (= "tickets" (first segments)) (= "assign-sprint" (nth segments 2)))
        (handle-ticket-assign-sprint (uuid (second segments)) request)

        (and (= method :post) (= 3 (count segments)) (= "tickets" (first segments)) (= "assign-milestone" (nth segments 2)))
        (handle-ticket-assign-milestone (uuid (second segments)) request)

        (and (= method :post) (= 3 (count segments)) (= "tickets" (first segments)) (= "tasks" (nth segments 2)))
        (handle-create-task (uuid (second segments)) request)

        (and (= method :get) (= 2 (count segments)) (= "workspaces" (first segments)))
        (handle-workspace-show (uuid (second segments)))

        (and (= method :get) (= 2 (count segments)) (= "tasks" (first segments)))
        (handle-task-show (uuid (second segments)))

        (and (= method :post) (= 3 (count segments)) (= "tasks" (first segments)) (= "status" (nth segments 2)))
        (handle-task-status (uuid (second segments)) request)

        (and (= method :post) (= 3 (count segments)) (= "tasks" (first segments)) (= "runs" (nth segments 2)))
        (handle-task-run (uuid (second segments)))

        (and (= method :get) (= 2 (count segments)) (= "attachments" (first segments)))
        (handle-attachment (uuid (second segments)))

        :else
        (not-found-page "Page not found."))
      (catch clojure.lang.ExceptionInfo ex
        (-> (html-response (layout/page "Error" (layout/panel (str "<p>" (ex-message ex) "</p>"))))
            (response/status 400))))))

(def app
  "Wrapped Ring app with form and multipart parsing.

   Returns:
   Ring handler."
  (-> handler
      multipart-params/wrap-multipart-params
      keyword-params/wrap-keyword-params
      params/wrap-params
      (resource/wrap-resource "public")))
