(ns com.blockether.styrmann.presentation.component.button
  "Standardized button components."
  (:require
   [com.blockether.styrmann.presentation.component.icon :as icon]))

(defn- merge-class [base attrs]
  (let [extra (:class attrs)]
    (if (seq extra)
      (str base " " extra)
      base)))

(defn- spinner []
  [:i {:data-lucide "loader-circle"
       :class "size-4 animate-spin"}])

(defn- btn-children [attrs children]
  (cond
    (:loading? attrs) [(spinner)]
    (:icon attrs)     (cons (icon/icon (:icon attrs)) children)
    :else             children))

(defn- clean-attrs [attrs]
  (dissoc attrs :class :icon :loading?))

(defn primary
  "Primary action button."
  [attrs & children]
  (into [:button (merge (clean-attrs attrs)
                   {:class (merge-class "btn-primary" attrs)})]
    (btn-children attrs children)))

(defn secondary
  "Secondary/outline button."
  [attrs & children]
  (into [:button (merge (clean-attrs attrs)
                   {:class (merge-class "btn-secondary" attrs)})]
    (btn-children attrs children)))

(defn ghost
  "Ghost/text button."
  [attrs & children]
  (into [:button (merge (clean-attrs attrs)
                   {:class (merge-class "btn-ghost" attrs)})]
    (btn-children attrs children)))

(defn danger
  "Danger button."
  [attrs & children]
  (into [:button (merge (clean-attrs attrs)
                   {:class (merge-class "btn-danger" attrs)})]
    (btn-children attrs children)))

(defn action-link
  "Link styled as a primary button."
  [attrs & children]
  (into [:a (merge (clean-attrs attrs)
               {:class (merge-class "btn-primary" attrs)})]
    (btn-children attrs children)))
