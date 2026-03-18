(ns com.blockether.styrmann.presentation.component.task-card
  "Reusable AI task card — warm editorial style."
  (:require
   [clojure.string :as str]
   [com.blockether.styrmann.presentation.component.layout :as layout]
   [com.blockether.styrmann.presentation.component.ui :as ui]))

(def ^:private next-statuses
  {:task.status/inbox        [:task.status/implementing]
   :task.status/implementing [:task.status/testing]
   :task.status/testing      [:task.status/reviewing]
   :task.status/reviewing    [:task.status/done]
   :task.status/done         []})

(defn board-card
  "Render a task as a board card.

   Params:
   `task` - Task read model.

   Returns:
   Hiccup node."
  [task]
  (ui/board-card-node
   {:href (str "/organizations/" (get-in task [:task/ticket :ticket/organization :organization/id]) "/tasks/" (:task/id task))
    :title (:task/description task)
    :badges [(ui/status-badge (:task/status task))]
    :footer [:span {:class "text-[11px] text-[var(--muted)]"}
             (get-in task [:task/workspace :workspace/name])]}))

(defn view
  "Render a task row with status transitions.

   Params:
   `task` - Task read model.

   Returns:
   Hiccup node."
  [task]
  (let [available (get next-statuses (:task/status task) [])
        done? (= :task.status/done (:task/status task))]
    [:div (cond-> {:class "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 card-sm px-4 py-3 hover:shadow-md transition-shadow"}
            done? (assoc :data-done "1"))
     [:div {:class "flex items-center gap-3 min-w-0"}
      (ui/status-badge (:task/status task))
      [:a {:href (str "/organizations/" (get-in task [:task/ticket :ticket/organization :organization/id]) "/tasks/" (:task/id task))
           :class "text-[13px] font-medium text-[var(--ink)] no-underline hover:text-[var(--accent)] truncate task-title"}
       (:task/description task)]
      [:span {:class "hidden sm:inline text-[11px] text-[var(--muted)] flex-shrink-0"}
       (get-in task [:task/workspace :workspace/name])]]
     (if (seq available)
       [:form {:method "post" :action (str "/organizations/" (get-in task [:task/ticket :ticket/organization :organization/id]) "/tasks/" (:task/id task) "/status")
               :class "flex gap-1.5 flex-shrink-0"}
        (for [status available]
          [:button {:class "btn-secondary !px-2.5 !py-1 !text-[11px] !rounded-md"
                    :type "submit"
                    :name "status"
                    :value (name status)}
           (str/replace (name status) "-" " ")])]
       [:span {:class "badge badge-done"} "Done"])]))

(defn render
  "Render a task card.

   Params:
   `task` - Task read model.

   Returns:
   HTML string."
  [task]
  (layout/render-fragment (view task)))
