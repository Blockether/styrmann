(ns com.blockether.styrmann.presentation.component.modal
  "Unified modal dialog component.
   All modals in the app should use shell for consistent styling,
   accessibility, and interaction behavior.")

(defn shell
  "Render a modal dialog shell.

   Params:
   `modal-id` - String. Unique ID for the modal (used by data-modal-open/close).
   `title`    - String. Modal heading.
   `subtitle` - String. Small label above the title.
   `body`     - Hiccup. Modal content.
   `opts`     - Map of optional keys:
                :footer - Hiccup or nil. Dedicated footer bar for action buttons.
                :size   - :sm, :md (default), or :lg.

   Returns:
   Hiccup vector for a modal backdrop + shell."
  ([modal-id title subtitle body]
   (shell modal-id title subtitle body nil))
  ([modal-id title subtitle body {:keys [footer size]}]
   (let [title-id  (str modal-id "-title")
         size-class (case size
                      :sm " modal-shell--sm"
                      :lg " modal-shell--lg"
                      nil)]
     [:div {:id modal-id
            :class "modal-backdrop"
            :role "dialog"
            :aria-modal "true"
            :aria-labelledby title-id}
      [:div {:class (str "modal-shell" size-class)}
       ;; Header
       [:div {:class "flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4"}
        [:div
         [:div {:class "field-label mb-1"} subtitle]
         [:h2 {:id title-id :class "text-[24px] leading-none"} title]]
        [:button {:type "button" :class "modal-close" :data-modal-close true}
         [:i {:data-lucide "x" :class "size-4"}]]]
       ;; Body
       [:div {:class "px-5 py-5"
              :style (when footer "flex: 1; overflow-y: auto;")}
        body]
       ;; Footer (optional)
       (when footer
         [:div {:class "border-t border-[var(--line)] px-5 py-4 flex items-center justify-end gap-2.5 flex-shrink-0"}
          footer])]])))
