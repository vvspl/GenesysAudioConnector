Clear previous processes:
docker stop $(docker ps -aq)
docker rm $(docker ps -aq)
docker network prune -f

Build new container:
docker build -t audio-connector-tunnel .

Run new container:
docker run --dns 8.8.8.8 --env-file .env -p 8081:8081 audio-connector-tunnel

Run ngrok:
ngrok http 8081
