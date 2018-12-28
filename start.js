/*jslint node: true */
'use strict';
const constants = require('byteballcore/constants.js');
const conf = require('byteballcore/conf');
const db = require('byteballcore/db');
const eventBus = require('byteballcore/event_bus');
const validationUtils = require('byteballcore/validation_utils');
const headlessWallet = require('headless-byteball');

function help(){
	return "Pose a question which will be sent to random set of people."
	+ "\nGet paid to answer questions by inserting your address using (...)"
	+ "\nOnly one question at a time to prevent spam."
}

var questions = {}

/**
 * headless wallet is ready
 */
eventBus.once('headless_wallet_ready', () => {
	headlessWallet.setupChatEventHandlers();
	
	/**
	 * user pairs his device with the bot
	 */
	eventBus.on('paired', (from_address, pairing_secret) => {
		// send a geeting message
		const device = require('byteballcore/device.js');
		device.sendMessageToDevice(from_address, 'text', "Time to incentivize Q&A! Type 'help' anytime.")
		device.sendMessageToDevice(from_address, 'text', help() )
	});

	/**
	 * user sends message to the bot
	 */
	eventBus.on('text', (from_address, text) => {
		// analyze the text and respond
		text = text.trim();
		var command = text.toLowerCase()

		const device = require('byteballcore/device.js');

		if( command != "help" ){
		  
			var exists = questions[ from_address ]
			if( exists ) device.sendMessageToDevice( from_address , 'text' , "Waiting for answers for your question : " + exists.text )
			else { 
				questions[ from_address ] = { 
					text : text ,
					sent : [ ] ,
					answers : [ ] ,
					bounty : 0 ,
					time : new Date()
					}
				// bot sends text to random sets of saved addresses
			}

		} else if( command == "boost" ){

			var exists = questions[ from_address ]
			if( !exists ) device.sendMessageToDevice( from_address , 'text' , "Please submit a question first before using boost"  )

			// bot sends text to more random sets of saved addresses based on bounty 

			
		} else device.sendMessageToDevice(from_address, 'text', help() )
	});

});


/**
 * user pays to the bot
 */
eventBus.on('new_my_transactions', (arrUnits) => {
	// handle new unconfirmed payments
	// and notify user
	
//	const device = require('byteballcore/device.js');
//	device.sendMessageToDevice(device_address_determined_by_analyzing_the_payment, 'text', "Received your payment");
});

/**
 * payment is confirmed
 */
eventBus.on('my_transactions_became_stable', (arrUnits) => {
	// handle payments becoming confirmed
	// and notify user
	
//	const device = require('byteballcore/device.js');
//	device.sendMessageToDevice(device_address_determined_by_analyzing_the_payment, 'text', "Your payment is confirmed");
});



process.on('unhandledRejection', up => { throw up; });

