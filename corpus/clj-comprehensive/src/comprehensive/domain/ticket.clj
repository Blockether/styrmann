(ns comprehensive.domain.ticket
  (:require
   [clojure.string :as str]))

(defn normalize-title [title]
  (-> title
      str/trim
      (str/replace #"\s+" " ")))

(defn valid-ticket? [{:keys [id title status]}]
  (and id
       (not (str/blank? (or title "")))
       (contains? #{:open :in-progress :done} status)))

(defn ready-for-delivery? [ticket tasks]
  (and (= :in-progress (:status ticket))
       (seq tasks)
       (every? #(= :done (:status %)) tasks)))
