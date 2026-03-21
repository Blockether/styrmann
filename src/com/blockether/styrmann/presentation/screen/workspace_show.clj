(ns com.blockether.styrmann.presentation.screen.workspace-show
  "SSR workspace screen — warm editorial task board."
  (:require
   [com.blockether.styrmann.db.organization :as db.organization]
   [com.blockether.styrmann.domain.organization :as organization]
   [com.blockether.styrmann.domain.task :as task]
   [com.blockether.styrmann.i18n :as i18n]
   [com.blockether.styrmann.presentation.component.layout :as layout]
   [com.blockether.styrmann.presentation.component.task-card :as task-card]
   [com.blockether.styrmann.presentation.component.ui :as ui]))

(defn render
  "Render a workspace screen.

   Params:
   `conn` - Datalevin connection.
   `workspace-id` - UUID. Workspace identifier.

   Returns:
   HTML page string."
  [conn workspace-id]
  (if-let [workspace (db.organization/find-workspace conn workspace-id)]
    (let [tasks (task/list-by-workspace conn workspace-id)
          org-name (get-in workspace [:workspace/organization :organization/name])
          org-id (get-in workspace [:workspace/organization :organization/id])
          org (db.organization/find-organization conn org-id)
          organizations (organization/list-organizations conn)
          body
          [:div
           [:div {:class "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6"}
            [:div {:class "flex items-center gap-4"}
             [:div {:class "flex items-center justify-center w-10 h-10 rounded-2xl bg-[var(--purple)] text-white"}
              [:i {:data-lucide "git-branch" :class "size-5"}]]
             [:div
              [:h1 {:class "text-[24px] leading-tight"} (:workspace/name workspace)]
              [:div {:class "text-[13px] text-[var(--muted)] mt-0.5"}
               (:workspace/repository workspace)]]]
            [:div {:class "flex items-center gap-3"}
             (ui/pill (str (count tasks) " tasks"))
             [:a {:href (str "/organizations/" org-id) :class "btn-secondary no-underline"} org-name]]]
           ;; Tasks
           (if (seq tasks)
             [:div
              (ui/section-heading {:title (i18n/t :workspace/all-tasks) :count (count tasks)})
              (into [:div {:class "mt-4 space-y-2"}]
                    (mapv task-card/view tasks))]
             (ui/empty-state (i18n/t :workspace/no-tasks)))]]
      (layout/page (:workspace/name workspace) body
                   {:breadcrumbs [{:href "/" :label "Organizations"}
                                  {:href (str "/organizations/" org-id) :label org-name}
                                  {:label (:workspace/name workspace)}]
                    :topbar-context (layout/render-fragment (ui/org-topbar-dropdown organizations org))}))
    (layout/page "Not found" [:p "Workspace not found."])))
