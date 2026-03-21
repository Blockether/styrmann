(ns com.blockether.styrmann.presentation.screen.home
  "SSR home screen — warm editorial organization listing."
  (:require
   [com.blockether.styrmann.domain.organization :as organization]
   [com.blockether.styrmann.i18n :as i18n]
   [com.blockether.styrmann.presentation.component.layout :as layout]
   [com.blockether.styrmann.presentation.component.ui :as ui]))

(defn- org-card [org]
  [:a (merge {:class "card p-6 block no-underline group hover:shadow-lg transition-shadow cursor-pointer"}
             (layout/nav-attrs (str "/organizations/" (:organization/id org))
                               (str "/fragments/organizations/" (:organization/id org))))
   [:div {:class "flex items-center gap-4"}
    [:div {:class "flex items-center justify-center w-12 h-12 rounded-2xl bg-[var(--accent)] text-white text-[20px] flex-shrink-0"
           :style "font-family: 'DM Serif Display', Georgia, serif"}
     (subs (:organization/name org) 0 1)]
    [:div {:class "min-w-0 flex-1"}
     [:div {:class "text-[16px] font-semibold text-[var(--ink)] group-hover:text-[var(--accent)] transition-colors"
            :style "font-family: 'DM Serif Display', Georgia, serif"}
      (:organization/name org)]
     [:div {:class "text-[13px] text-[var(--muted)] mt-0.5"}
      (i18n/t :home/org-subtitle)]]
    [:i {:data-lucide "arrow-right" :class "size-5 text-[var(--line-strong)] group-hover:text-[var(--accent)] transition-colors flex-shrink-0"}]]])

(defn- body-content [conn]
  (let [organizations (organization/list-organizations conn)]
    [:div
     [:div {:class "text-center mb-10"}
      [:h1 {:class "text-[36px] sm:text-[44px] leading-tight"}
       (i18n/t :home/headline-1)]
      [:h1 {:class "text-[36px] sm:text-[44px] leading-tight"}
       [:span {:class "italic text-[var(--accent)]"
               :style "font-family: 'DM Serif Display', Georgia, serif"} (i18n/t :home/headline-2)]
       "."]
      [:p {:class "mt-4 text-[15px] text-[var(--muted)] max-w-lg mx-auto leading-relaxed"}
       (i18n/t :home/subtitle)]]
     [:div {:class "max-w-2xl mx-auto"}
      (if (seq organizations)
        (into [:div {:class "space-y-3"}]
              (map org-card organizations))
        (ui/empty-state (i18n/t :home/no-orgs)))
      [:div {:class "card p-6 mt-8"}
       [:div {:class "flex items-center gap-3 mb-4"}
        [:div {:class "flex items-center justify-center w-8 h-8 rounded-xl bg-[var(--cream-dark)]"}
         [:i {:data-lucide "plus" :class "size-4 text-[var(--ink-secondary)]"}]]
        [:h2 {:class "text-[18px]"} (i18n/t :home/create-org)]]
       [:form {:class "flex flex-col sm:flex-row gap-3" :method "post" :action "/organizations"}
        [:label {:class "flex-1"}
         [:span {:class "field-label"} (i18n/t :home/org-name)]
         [:input {:class "input" :type "text" :name "name" :placeholder "Blockether" :required true}]]
        [:button {:class "btn-primary sm:self-end sm:mb-0" :type "submit"} (i18n/t :home/create-btn)]]]]]))

(defn render
  "Render the home screen.

   Params:
   `conn` - Datalevin connection.

   Returns:
   HTML page string."
  [conn]
  (layout/page "Organizations" (body-content conn)))

(defn render-body
  "Render only the home body fragment for SSE patching.

   Params:
   `conn` - Datalevin connection.

   Returns:
   Map with :body-html and :breadcrumbs."
  [conn]
  {:body-html (layout/render-fragment (body-content conn))
   :breadcrumbs []})
