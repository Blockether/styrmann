(ns com.blockether.styrmann.presentation.component.icon
  "Lucide icon component.")

(defn icon
  "Render a Lucide icon by name.

   Params:
   `name` - string. Lucide icon name (e.g. \"sparkles\").
   `opts` - optional map with `:class` and `:size` (default \"4\")."
  [name & [{:keys [class size] :or {size "4"}}]]
  [:i {:data-lucide name
       :class (str "size-" size (when class (str " " class)))}])
