(ns com.blockether.styrmann.presentation.screen.task-show
  "SSR task detail — warm editorial view."
  (:require
   [clojure.string :as str]
   [com.blockether.styrmann.db.organization :as db.organization]
   [com.blockether.styrmann.db.task :as db.task]
   [com.blockether.styrmann.domain.opencode-run :as opencode-run]
   [com.blockether.styrmann.domain.organization :as organization]
   [com.blockether.styrmann.presentation.component.layout :as layout]
   [com.blockether.styrmann.presentation.component.ui :as ui]))

(def ^:private next-statuses
  {:task.status/inbox        [:task.status/implementing]
   :task.status/implementing [:task.status/testing]
   :task.status/testing      [:task.status/reviewing]
   :task.status/reviewing    [:task.status/done]
   :task.status/done         []})

(defn- status-label [status]
  (-> status name (str/replace "-" " ") str/capitalize))

(defn- detail-row [label content]
  [:div {:class "flex items-start gap-3 py-2.5 border-b border-[var(--line)] last:border-b-0"}
   [:span {:class "w-24 flex-shrink-0 field-label pt-0.5"} label]
   [:div {:class "flex-1"} content]])

(defn- run-card [run]
  [:div {:class "card overflow-hidden"}
   [:div {:class "flex items-center justify-between px-4 py-3 bg-[var(--cream-dark)] border-b border-[var(--line)]"}
    [:div {:class "flex items-center gap-2"}
     (ui/status-badge (:run/status run))
     [:span {:class "text-[12px] text-[var(--muted)]"} (str "PID " (:opencode-run/pid run))]]
    (when-let [exit-code (:run/exit-code run)]
      (ui/pill (str "Exit " exit-code)))]
   [:div {:class "bg-[#1a1a1f] p-4 rounded-b-3xl"}
    [:pre {:class "text-[12px] leading-relaxed text-[#e8e6e3] overflow-x-auto whitespace-pre-wrap font-mono"}
     (or (some-> (:run/logs run) str) "No logs captured yet.")]]])

(defn render
  "Render a task detail screen.

   Params:
   `conn` - Datalevin connection.
   `task-id` - UUID. Task identifier.

   Returns:
   HTML page string."
  [conn task-id]
  (if-let [task (db.task/find-task conn task-id)]
    (let [runs (opencode-run/list-by-task conn task-id)
          available (get next-statuses (:task/status task) [])
          ticket-desc (or (get-in task [:task/ticket :ticket/title])
                          (get-in task [:task/ticket :ticket/description]))
          ticket-id (get-in task [:task/ticket :ticket/id])
          ws-name (get-in task [:task/workspace :workspace/name])
          ws-id (get-in task [:task/workspace :workspace/id])
          org-name (get-in task [:task/ticket :ticket/organization :organization/name])
          org-id (get-in task [:task/ticket :ticket/organization :organization/id])
          org (db.organization/find-organization conn org-id)
          organizations (organization/list-organizations conn)
          body
          [:div {:class "grid gap-6 lg:grid-cols-[1fr_300px]"}
           [:div {:class "space-y-5"}
            [:div
             [:div {:class "flex items-center gap-2 mb-3"}
              (ui/status-badge (:task/status task))]
             [:h1 {:class "text-[24px] leading-tight"}
              (:task/description task)]]
            (when (seq available)
              [:div {:class "flex flex-wrap items-center gap-2"}
               [:span {:class "text-[13px] text-[var(--muted)]"} "Transition:"]
               [:form {:method "post" :action (str "/organizations/" org-id "/tasks/" task-id "/status")
                       :class "flex gap-2"}
                (for [s available]
                  [:button {:class "btn-primary" :type "submit" :name "status" :value (subs (str s) 1)}
                   (status-label s)])]])
            [:div
             (ui/section-heading {:title "Run history" :count (count runs)})
             (if (seq runs)
               (into [:div {:class "mt-4 space-y-3"}]
                     (map run-card runs))
               (ui/empty-state "No process runs recorded." "mt-4"))]]
           [:aside {:class "space-y-4"}
            [:div {:class "card p-5"}
             [:div {:class "field-label mb-3"} "Details"]
             (detail-row "Status" (ui/status-badge (:task/status task)))
             (detail-row "Runs" [:span {:class "text-[14px] font-bold"} (count runs)])
             (detail-row "Ticket"
                         [:a {:href (str "/organizations/" org-id "/tickets/" ticket-id)} ticket-desc])
             (detail-row "Workspace"
                         [:a {:href (str "/organizations/" org-id "/workspaces/" ws-id)} ws-name])
             (detail-row "Organization"
                         [:a {:href (str "/organizations/" org-id)} org-name])]]]]
      (layout/page "Task" body
                   {:breadcrumbs [{:href "/" :label "Organizations"}
                                  {:href (str "/organizations/" org-id) :label org-name}
                                  {:href (str "/organizations/" org-id "/tickets/" ticket-id) :label (subs ticket-desc 0 (min 30 (count ticket-desc)))}
                                  {:label (subs (:task/description task) 0 (min 30 (count (:task/description task))))}]
                    :topbar-context (layout/render-fragment (ui/org-topbar-dropdown organizations org))}))
    (layout/page "Not found" [:p "Task not found."])))
