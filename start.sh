#!/bin/bash

echo "Downloading Lavalink..."
mkdir -p bot/lavalink
cd bot/lavalink

curl -L -o Lavalink.jar https://github.com/lavalink-devs/Lavalink/releases/latest/download/Lavalink.jar

echo "Starting Lavalink..."
java -jar Lavalink.jar &

sleep 5

echo "Starting VinRadio..."
cd ../..
node index.js