(ns com.blockether.styrmann.presentation.screen.task-show
  "SSR task detail — warm editorial view."
  (:require
   [clojure.edn :as edn]
   [clojure.string :as str]
   [com.blockether.styrmann.db.git :as db.git]
   [com.blockether.styrmann.db.organization :as db.organization]
   [com.blockether.styrmann.db.task :as db.task]
   [com.blockether.styrmann.domain.organization :as organization]
   [com.blockether.styrmann.execution.session :as session]
   [com.blockether.styrmann.presentation.component.git-progress :as git-progress]
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
     [:span {:class "text-[12px] text-[var(--muted)]"} (str "PID " (:session/pid run))]]
    (when-let [exit-code (:run/exit-code run)]
      (ui/pill (str "Exit " exit-code)))]
   [:div {:class "bg-[#1a1a1f] p-4 rounded-b-3xl"}
    [:pre {:class "text-[12px] leading-relaxed text-[#e8e6e3] overflow-x-auto whitespace-pre-wrap font-mono"}
     (or (some-> (:run/logs run) str) "No logs captured yet.")]
    (when (seq (:session/events run))
      [:div {:class "mt-3 rounded-xl bg-[#242429] border border-[#33333a] p-3"}
       [:div {:class "text-[11px] uppercase tracking-[0.08em] text-[#b7b6c2] mb-2"} "Events"]
       (into [:div {:class "space-y-1.5"}]
             (for [event (:session/events run)]
               [:div {:class "text-[11px] text-[#d8d7de]"}
                [:span {:class "text-[#9e9daa] mr-2"} (name (:session.event/type event))]
                (:session.event/message event)]))])]])

(defn render
  "Render a task detail screen.

   Params:
   `conn` - Datalevin connection.
   `task-id` - UUID. Task identifier.

   Returns:
   HTML page string."
  [conn task-id]
  (if-let [task (db.task/find-task conn task-id)]
    (let [runs (mapv (fn [run]
                       (assoc run :run/status (:session/runtime-status run)
                              :run/logs (:session/logs run)
                              :run/exit-code (:session/exit-code run)
                              :session/events (session/list-session-events conn (:session/id run))))
                     (session/list-by-task conn task-id))
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
            (let [deliverables (when-let [edn-str (:task/deliverables-edn task)]
                                (try (edn/read-string edn-str) (catch Exception _ nil)))]
              (when (seq deliverables)
                [:div
                 (ui/section-heading {:title "Deliverables" :count (count deliverables)})
                 [:div {:class "mt-3 space-y-2"}
                  (for [{:keys [title description status]} deliverables]
                    [:div {:class "card p-4 flex items-start gap-3"}
                     [:div {:class "mt-0.5"}
                      (if (= status "done")
                        [:i {:data-lucide "check-circle" :class "w-4 h-4 text-[var(--good)]"}]
                        [:i {:data-lucide "circle" :class "w-4 h-4 text-[var(--muted)]"}])]
                     [:div
                      [:div {:class "text-[14px] font-medium"} title]
                      (when (and description (not (str/blank? description)))
                        [:div {:class "text-[13px] text-[var(--ink-secondary)] mt-0.5"} description])]])]]))
            (let [ws-id (get-in task [:task/workspace :workspace/id])
                  git-commits (when ws-id
                                (when-let [repo (db.git/find-repo-by-workspace conn ws-id)]
                                  (->> (db.git/list-commits-by-repo conn (:git.repo/id repo))
                                       (map (fn [c]
                                              {:sha (:git.commit/sha c)
                                               :message (:git.commit/message c)
                                               :author (some-> c :git.commit/author :git.author/name)
                                               :date (some-> c :git.commit/authored-at str)}))
                                       vec)))]
              (git-progress/commits-section git-commits {:title "Git Activity"}))
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
