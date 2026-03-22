(ns com.blockether.styrmann.presentation.component.command-palette
  "Command Palette component."
  (:require
   [com.blockether.styrmann.presentation.component.icon :as icon]))

(defn shell
  ([palette-id placeholder]
   (shell palette-id placeholder nil))
  ([palette-id placeholder {:keys [aria-label input-id actions]
                             :or   {aria-label "Command palette"}}]
  (let [input-id (or input-id (str palette-id "-input"))]
    [:div {:id palette-id
           :class "command-palette-backdrop"
           :role "dialog"
           :aria-modal "true"
           :aria-label aria-label}
     [:div {:class "command-palette-shell"}
      [:div {:class "command-palette-input-row"}
       [:i {:data-lucide "search" :class "size-5 text-[var(--muted)] flex-shrink-0"}]
       [:input {:id input-id
                :type "search"
                :class "command-palette-input"
                :placeholder placeholder
                :autocomplete "off"
                :autofocus true}]
       [:kbd {:class "command-palette-kbd"}
        [:span {:class "hidden sm:inline"} "⌘"]
        [:span {:class "sm:hidden"} "Ctrl+"]
        "K"]]
      (when actions
        [:div {:class "command-palette-actions"}
         actions])]])))
