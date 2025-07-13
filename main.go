package main

import (
	"context"
	"fmt"
	"log"

	"cloud.google.com/go/firestore"
	"github.com/NosikovNeOleg/random_fitness/repository"
)

func main() {
	print("start")
	readFitnessCollection()
	print("end")
}

func init() {
	print("Initializing the App")
	repository.InitializeFirebase()
	print("Initializing succesfull")
}


func readFitnessCollection() {
	ctx := context.Background()
	app := repository.FirebaseApp
	if app == nil {
		log.Fatal("FirebaseApp is not initialized")
	}

	client, err := app.Firestore(ctx)
	if err != nil {
		log.Fatalf("Failed to create Firestore client: %v", err)
	}
	defer client.Close()

	iter := client.Collection("fitness").Documents(ctx)
	defer iter.Stop()

	for {
		doc, err := iter.Next()
		if err != nil {
			break 
		}
		fmt.Printf("Document ID: %s, Data: %#v\n", doc.Ref.ID, doc.Data())
	}
}