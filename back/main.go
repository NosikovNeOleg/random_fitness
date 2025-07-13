package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"strconv"

	"github.com/NosikovNeOleg/random_fitness/repository"
)

func init() {
	log.Print("Initializing the App")
	repository.InitializeFirebase()
	log.Print("Initializing succesfull")
}

func readFitnessByID(ctx context.Context, id string) (map[string]interface{}, error) {
	app := repository.FirebaseApp
	if app == nil {
		return nil, fmt.Errorf("FirebaseApp is not initialized")
	}
	client, err := app.Firestore(ctx)
	if err != nil {
		return nil, fmt.Errorf("Failed to create Firestore client: %v", err)
	}
	defer client.Close()

	doc, err := client.Collection("fitness").Doc(id).Get(ctx)
	if err != nil {
		return nil, fmt.Errorf("Failed to get document: %v", err)
	}
	return doc.Data(), nil
}

func fitnessHandler(w http.ResponseWriter, r *http.Request) {
	ctx := context.Background()
	counter, err := readFitnessByID(ctx, "counter")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	numberOfElements := counter["count"].(int64)
	randomNumber := rand.Int63n(numberOfElements)

	data, err := readFitnessByID(ctx, strconv.FormatInt(randomNumber, 10))

	amounts, ok := data["amount"].([]any)
	var randomAmount any
	if ok && len(amounts) > 0 {
		randomIdx := rand.Intn(len(amounts))
		randomAmount = amounts[randomIdx]
	}

	response := map[string]any{
		"action":       data["action"],
		"randomAmount": randomAmount,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}


func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/fitness", fitnessHandler)

	http.ListenAndServe(":4477", mux)
}
