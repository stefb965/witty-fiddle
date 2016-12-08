# WittyFiddle

WittyFiddle is a simple prototyping tool that lets you run your Wit stories and javascript functions directly in browser, with no server setup needed. You can share and clone these fiddles with other developers, and when you're ready, you can deploy to heroku to test it out on Messenger.

Check out an example of a weather bot here: 

**https://wit-ai.github.io/witty-fiddle/?id=5a387f6ccb4be4a1f77f2113747a558a**

![overview](/doc-images/overview.png)

## How it works:

The architecture can be split into 4 separate pieces:

A) **Chat Bot**: An in-browser chat emulator, that receives user messages and displays bot responses

B) **Logs**: The logs of the in-browser emulated node server, which receives/sends user messages, asks Wit what to do next, and also executes middle-man actions (like fetching weather on https://api.apixu.com/)

C) **Actions**: The Javascript functions to execute in your in-browser emulated server

D) **The Wit App**: The separate Wit app, which tells the node server what to do next based on Stories. You build these stories directly in Wit, and just link your stories to WittyFiddle using the client token

## How to use:

### 1. Create Your Wit App

You can use [Wit.ai](https://wit.ai) to manage how your bot understands what your user sends you, and figures out how to respond. Check out the [weather bot stories](https://wit.ai/stopa-staging/WittyWeather).

### 2. Connect Your App in WittyFiddle

Once you've built your app in Wit, it's time connect it to your fiddle. In Wit, go to your settings, and copy your client token.

<p align="center"><img src="/doc-images/wit-client-token.png" width="80%" /></p>

This token is what WittyFiddle will use to communicate with your Wit App. Paste it in the token field of your WittyFiddle.

<p align="center"><img src="/doc-images/fiddle-client-token.png" width="300px" /></p>

### 3. Write your actions

You should already be able to start testing out your bot in the fiddle. However, if you've defined custom actions in your stories, we will need to tell the fiddle how to execute them.

For example, the demo wit app has a `fetchWeather` action, so we would implement a `fetchWeather` function in javascript, so that the server knows what to do.

<p align="center"><img src="/doc-images/writing-action.png" width="80%" /></p>

At this point, you can test your fiddle in browser, and iterate on your bot. You should see the "Save & Clone" button turn green. Press it, to save your changes, and get a custom URL for your fiddle. Careful! Every time you make a change, you need to save it, and it will create a new version of your fiddle with a new custom URL.

This is a great way to share your creations with your friends. We're going to be featuring the best fiddles here, so if you have something cool, please share with us!

### 3. Try it out in Messenger

Once you're happy with your fiddle, you can deploy it to messenger. To make it easy for you, we've created a way to auto-deploy to heroku. To start the process, press the "Deploy button"

<p align="center"><img src="/doc-images/deploy-button.png" width="300px" /></p>

#### Connect to Heroku

To connect to messenger, you need to have a server running. WittyFiddle can upload your code to a provider like heroku. You can click "Connect to Heroku" to get started in the automated process, or click "Download Zip" to do it yourself, or put your code on a different server provider.

<p align="center"><img src="/doc-images/connect-to-heroku.png" width="400px" /></p>

#### Provide your Page token

The first thing you need to do is to get a page token. Follow the [quickstart](https://developers.facebook.com/docs/messenger-platform/guides/quick-start) on the Messenger Platform, and generate the page token on the Messenger Product page

<p align="center"><img src="/doc-images/messenger-page-token.png" width="80%" /></p>

<p align="center"><img src="/doc-images/fiddle-page-token.png" width="300px" /></p>

#### Deploy your heroku app

Now that you have a page token, you can deploy your heroku app. Click "Create a Heroku App", to generate a new instance on heroku, then click "Deploy", to ship the code.

<p align="center"><img src="/doc-images/create-heroku.png" width="300px" /></p>

#### Set up webhooks

Now that your server is up and running, it's time to let Messenger know about it. Go to the webhooks section of your Messenger Product, click "Set up Webhooks", and copy the webhook url and verify token from witty fiddle

<p align="center"><img src="/doc-images/webhooks.png" width="80%" /></p>

The final step, is to subscribe the page users will use to talk to your bot in Messenger Platform.

<p align="center"><img src="/doc-images/subscribe.png" width="80%" /></p>

And you should be on your way. Go to messenger, and start chatting with your bot!

## Questions

### What if I don't want to use Heroku?

No problem! You can download a zip file and deploy it on your own server. We've provided an auto-deploy to heroku as a facilitator, but by all means feel free to use your own stack! :)

<p align="center"><img src="/doc-images/download-zip.png" width="300px" /></p>
