#!/bin/bash

cd /tmp

wget -q https://github.com/lavalink-devs/Lavalink/releases/download/4.2.2/Lavalink.jar -O Lavalink.jar

cp /app/bot/lavalink/application.yml ./application.yml

java -jar Lavalink.jar