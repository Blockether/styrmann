(ns com.blockether.styrmann.presentation.screen.organization-settings
  "SSR organization settings screen."
  (:require
   [com.blockether.styrmann.domain.organization :as organization]
   [com.blockether.styrmann.presentation.component.layout :as layout]
   [com.blockether.styrmann.presentation.component.ui :as ui]))

(defn render
  "Render an organization settings screen.

   Params:
   `conn` - Datalevin connection.
   `organization-id` - UUID. Organization identifier.

   Returns:
   HTML page string."
  [conn organization-id]
  (if-let [org (organization/overview conn organization-id)]
    (let [organizations (organization/list-organizations conn)]
      (layout/page
       "Organization settings"
       [:div {:class "max-w-3xl space-y-6"}
        [:div
         [:h1 {:class "text-[28px] leading-tight"} "Organization settings"]
         [:p {:class "mt-2 text-[14px] text-[var(--muted)]"}
          "Manage the default landing organization and future organization preferences here."]]
        [:div {:class "card p-6"}
         [:div {:class "field-label mb-3"} "Current organization"]
         [:div {:class "text-[20px]" :style "font-family: 'DM Serif Display', Georgia, serif"}
          (:organization/name org)]
         [:p {:class "mt-2 text-[13px] text-[var(--muted)]"}
          (if (:organization/default? org)
            "This organization is the default landing organization."
            "This organization is not the default landing organization yet.")]]]
       {:breadcrumbs [{:href "/" :label "Organizations"}
                      {:href (str "/organizations/" organization-id) :label (:organization/name org)}
                      {:label "Settings"}]
        :topbar-context (layout/render-fragment (ui/org-topbar-dropdown organizations org))}))
    (layout/page "Not found" [:p "Organization not found."])))
