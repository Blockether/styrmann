(ns com.blockether.styrmann.presentation.component.notification-list
  "Organization notification rendering — activity feed."
  (:require
   [com.blockether.styrmann.presentation.component.layout :as layout]
   [com.blockether.styrmann.presentation.component.ui :as ui]))

(defn view
  "Render a notification list.

   Params:
   `notifications` - Seq of notification maps.

   Returns:
   Hiccup node."
  [notifications]
  (if (seq notifications)
    (into [:div {:class "space-y-1"}]
          (map (fn [n]
                 [:div {:class "flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-[var(--cream-dark)] transition-colors"}
                  (ui/status-badge (:notification/status n))
                  [:div {:class "min-w-0 flex-1"}
                   [:a {:href (str "/organizations/"
                                   (get-in n [:notification/organization :organization/id])
                                   "/tasks/"
                                   (get-in n [:notification/task :task/id]))
                        :class "text-[13px] font-medium text-[var(--ink)] no-underline hover:text-[var(--accent)] truncate block"}
                    (get-in n [:notification/task :task/description])]
                   [:span {:class "text-[11px] text-[var(--muted)]"}
                    (get-in n [:notification/task :task/ticket :ticket/description])]]]))
          notifications)
    [:div {:class "text-[13px] text-[var(--muted)] py-4 text-center"}
     "No activity yet."]))

(defn render
  "Render a notification list.

   Params:
   `notifications` - Seq of notification maps.

   Returns:
   HTML string."
  [notifications]
  (layout/render-fragment (view notifications)))
