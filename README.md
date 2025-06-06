# gm-media

You will need to add the following open-api ai key to your env variables in order to start
the realtime session properly

```commandline
export OPENAI_API_KEY='your key here'
```

To run this project, 

go to web/src and run the following command

install the latest webpack@5.99.9

```commandline
npm install --save-dev webpack webpack-cli
```

Then to install the project run the folliwng 

```commandline
yarn install --frozen-lockfile
webpack
npm start
```

might need to do 

```commandline
npm i
``` 

Once running successfully you should be able to access your bots ui at localhost:9720

0. enter client-id 715691994908-8b6i1pu8aqdfknthdhhvuuk7l9nbasmm.apps.googleusercontent.com
1. enter meet key
2. login
3. create client
4. join session
5. say the voice command "hey hackerman" to begin the realtime session
6. share screen with users. 
7. being ai session as poc 