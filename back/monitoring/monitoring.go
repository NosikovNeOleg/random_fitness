package random_fitness


import (
    "fmt"
    "net/http"
)

// HealthHandler responds to /health requests with "OK".
func HealthHandler(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusOK)
    fmt.Fprintln(w, "OK")
}

func StartMonitoringServer(addr string) {
    http.HandleFunc("/health", HealthHandler)

    go func() {
        if err := http.ListenAndServe(addr, nil); err != nil {
            fmt.Printf("Monitoring server failed: %v\n", err)
        }
    }()
}