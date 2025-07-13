package repository

import (
    "context"
    "log"
    "os"

    firebase "firebase.google.com/go/v4"
    "google.golang.org/api/option"
)

var FirebaseApp *firebase.App

func InitializeFirebase() {
	print("Starting db connection")
    ctx := context.Background()
    credFile := os.Getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if credFile == "" {
        log.Fatal("GOOGLE_APPLICATION_CREDENTIALS environment variable not set")
    }

    opt := option.WithCredentialsFile(credFile)
    app, err := firebase.NewApp(ctx, nil, opt)
    if err != nil {
        log.Fatalf("error initializing firebase app: %v", err)
		panic("DB is not connected! Aborting...")
    }
    FirebaseApp = app
	
}