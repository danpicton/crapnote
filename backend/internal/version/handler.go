package version

import (
	"encoding/json"
	"net/http"
)

type Handler struct {
	checker *Checker
}

func NewHandler(checker *Checker) *Handler {
	return &Handler{checker: checker}
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(h.checker.Status(r.Context()))
}
