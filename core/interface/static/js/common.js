let MQTT;
let mqttSubscribers = {};
let MQTT_HOST;
let MQTT_PORT;
let LAST_CORE_HEARTBEAT = 0;
let MAIN_GOING_DOWN = false;

function getCookie(cname) {
	let name = cname + '=';
	let decodedCookie = decodeURIComponent(document.cookie);
	let ca = decodedCookie.split(';');
	for (let i = 0; i < ca.length; i++) {
		let c = ca[i];
		while (c.charAt(0) == ' ') {
			c = c.substring(1);
		}
		if (c.indexOf(name) == 0) {
			return c.substring(name.length, c.length);
		}
	}
	return '';
}

function unsetCookie(cname) {
	document.cookie = cname + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC;';
}

function mqttRegisterSelf(target, method) {
	if (!mqttSubscribers.hasOwnProperty(method)) {
		mqttSubscribers[method] = [];
	}

	mqttSubscribers[method].push(target);
}

$(document).tooltip();

$(function () {

	function onFailure(_msg) {
		console.log('Mqtt connection failed, retry in 5 seconds');
		setTimeout(function () {
			connectMqtt();
		}, 5000);
	}

	function onConnect(msg) {
		console.log('Mqtt connected');
		dispatchToMqttSubscribers('onConnect', msg);
	}

	function onMessage(msg) {
		dispatchToMqttSubscribers('onMessage', msg);
	}

	function onConnectionLost(resObj) {
		console.log('Mqtt disconnected, automatic reconnect is enabled Error code: ' + resObj.errorCode + ' - ' + resObj.errorMessage);
		connectMqtt();
	}

	function dispatchToMqttSubscribers(method, msg) {
		if (!mqttSubscribers.hasOwnProperty(method)) {
			return;
		}

		for (const func of mqttSubscribers[method]) {
			func(msg);
		}
	}

	function connectMqtt() {
		console.log('Connecting to Mqtt server');
		$.ajax({
			url : '/home/getMqttConfig/',
			type: 'POST'
		}).done(function (response) {
			if (response.success) {
				MQTT_HOST = response.host;
				MQTT_PORT = Number(response.port);
				if (MQTT_HOST === 'localhost') {
					MQTT_HOST = window.location.hostname;
				}
				let randomNum = Math.floor((Math.random() * 10000000) + 1);
				MQTT = new Paho.MQTT.Client(MQTT_HOST, MQTT_PORT, 'ProjectAliceInterface' + randomNum);
				MQTT.onMessageArrived = onMessage;
				MQTT.onConnectionLost = onConnectionLost;
				MQTT.connect({
					onSuccess: onConnect,
					onFailure: onFailure,
					timeout  : 5
				});
			} else {
				console.log('Failed fetching MQTT settings');
				setTimeout(function () {
					connectMqtt();
				}, 5000);
			}
		}).fail(function () {
			console.log('Coulnd\'t get MQTT information');
			setTimeout(function () {
				connectMqtt();
			}, 5000);
		});
	}

	function onConnected() {
		MQTT.subscribe('projectalice/nlu/trainingStatus');
		MQTT.subscribe('projectalice/skills/instructions');
		MQTT.subscribe('projectalice/devices/coreHeartbeat');
		MQTT.subscribe('projectalice/devices/coreReconnection');
		MQTT.subscribe('projectalice/devices/coreDisconnection');
		MQTT.subscribe('projectalice/skills/coreConfigUpdateWarning');
		MQTT.subscribe('projectalice/devices/resourceUsage');
	}

	function onMessageIn(msg) {
		if (msg.topic == 'projectalice/nlu/trainingStatus') {
			let payload = JSON.parse(msg.payloadString);
			let $container = $('#aliceStatus');
			if (payload.status == 'training') {
				if ($container.text().length <= 0) {
					$container.text('Nlu training');
				} else {
					let count = ($container.text().match(/\./g) || []).length;
					if (count < 10) {
						$container.text($container.text() + '.');
					} else {
						$container.text('Nlu training.');
					}
				}
			} else if (payload.status == 'failed') {
				$container.text('Nlu training failed...');
			} else if (payload.status == 'done') {
				$container.text('Nlu training done!');
			}
		} else if (msg.topic == 'projectalice/skills/instructions') {
			let payload = JSON.parse(msg.payloadString);
			$('#skillInstructions').show();
			let $content = $('#skillInstructionsContent');
			$content.html($content.html() + payload['instructions']);
		} else if (msg.topic == 'projectalice/devices/coreHeartbeat') {
			LAST_CORE_HEARTBEAT = Date.now();
		} else if (msg.topic == 'projectalice/skills/coreConfigUpdateWarning') {
			$('#serverUnavailable').hide();
			let $nodal = $('#coreConfigUpdateAlert');
			$nodal.show();

			let payload = JSON.parse(msg.payloadString);

			let $container = $('#overlaySkillContent');
			if ($container.children().length <= 0) {
				$container.append('<div id="confWarning_' + payload['skill'] + '"><div class="overlaySubtitle">' + payload['skill'] + '</div><div class="overlaySubtext">' + payload['key'] + ' => ' + payload['value'] + '</div></div>');
			} else {
				let $skillWarning = $('#confWarning_' + payload['skill']);

				if ($skillWarning.length == 0) {
					$container.append('<div id="confWarning_' + payload['skill'] + '"><div class="overlaySubtitle">' + payload['skill'] + '</div><div class="overlaySubtext">' + payload['key'] + ' => ' + payload['value'] + '</div></div>');
				} else {
					$skillWarning.append('<div class="overlaySubtext">' + payload['key'] + ' => ' + payload['value'] + '</div>');
				}
			}
		} else if (msg.topic == 'projectalice/devices/resourceUsage') {
			let $div = $('#resourceUsage');
			if ($div.length == 0) {
				return;
			}
			let payload = JSON.parse(msg.payloadString);
			$div.text(`CPU: ${payload['cpu']}% RAM: ${payload['ram']}% SWP: ${payload['swp']}%`);
		} else if (msg.topic == 'projectalice/devices/coreDisconnection') {
			$('#serverUnavailable').show();
			MAIN_GOING_DOWN = true;
		} else if (msg.topic == 'projectalice/devices/coreReconnection') {
			$('#serverUnavailable').hide();
			MAIN_GOING_DOWN = false;
		}
	}

	function checkCoreStatus() {
		if (MAIN_GOING_DOWN) {
			return;
		}

		let $nodal = $('#serverUnavailable');

		if (LAST_CORE_HEARTBEAT > 0 && Date.now() > LAST_CORE_HEARTBEAT + 4000) {
			$nodal.show();
		} else {
			if ($nodal.is(':visible')) {
				$nodal.hide();
				location.reload();
			}
		}
	}

	let $defaultTab = $('.tabsContainer ul li:first');
	$('.tabsContent').children().each(function () {
		if ($(this).attr('id') == $defaultTab.data('for')) {
			$(this).show();
		} else {
			$(this).hide();
		}
	});

	$('.tab').on('click touch', function () {
		let target = $(this).data('for');
		$(this).addClass('activeTab');

		$('.tabsContainer ul li').each(function () {
			if ($(this).data('for') != target) {
				$(this).removeClass('activeTab');
			}
		});

		$('.tabsContent').children().each(function () {
			if ($(this).attr('id') == target) {
				$(this).show();
			} else {
				$(this).hide();
			}
		});
		return false;
	});

	$('.overlayInfoClose').on('click touch', function () {
		$(this).parent().hide();
	});

	$('#refuseAliceConfUpdate').on('click touch', function () {
		$.post('/admin/refuseAliceConfigUpdate/').done(function () {
			$('#coreConfigUpdateAlert').hide();
		});
	});

	$('#acceptAliceConfUpdate').on('click touch', function () {
		$.post('/admin/acceptAliceConfigUpdate/').done(function () {
			$('#coreConfigUpdateAlert').hide();
		});
	});

	mqttRegisterSelf(onConnected, 'onConnect');
	mqttRegisterSelf(onMessageIn, 'onMessage');

	connectMqtt();

	setInterval(checkCoreStatus, 2000);

	let $checkboxes = $(':checkbox');
	if ($checkboxes.length) {
		$checkboxes.checkToggler();
	}

	// Z-indexers
	let $zindexed = $('.z-indexed');
	if ($zindexed.length) {
		zIndexMe($zindexed);
	}
});

function reorder($arrow, direction) {
	let $widget = $arrow.parent().parent();
	let $container = $widget.parent();
	let $family = $container.children('.z-indexed');

	let actualIndex = $widget.css('z-index');
	try {
		actualIndex = parseInt(actualIndex);
	} catch {
		actualIndex = 0;
	}

	let toIndex;
	if (direction === 'down') {
		toIndex = Math.max(0, actualIndex - 1);
	} else {
		let highest = 0;
		$family.each(function () {
			try {
				if (parseInt($(this).css('z-index')) > highest) {
					highest = parseInt($(this).css('z-index'));
				}
			} catch {
				return true;
			}
		});
		toIndex = actualIndex + 1;
		if (toIndex > highest) {
			return;
		}
	}

	$family.each(function () {
		try {
			if ($(this) != $widget && parseInt($(this).css('z-index')) == toIndex) {
				$(this).css('z-index', actualIndex);
			}
		} catch {
			return true;
		}
	});
	$widget.css('z-index', toIndex);
}


function zIndexMe($zindexed) {
	let $indexUp = $('<div class="zindexer-up clickable"><i class="fas fa-chevron-circle-up fa-2x" aria-hidden="true"></i></div>');
	let $indexDown = $('<div class="zindexer-down clickable"><i class="fas fa-chevron-circle-down fa-2x" aria-hidden="true"></i></div>');

	$indexUp.on('click touch', function () {
		reorder($(this), 'up');
	});
	$indexDown.on('click touch', function () {
		reorder($(this), 'down');
	});

	let $zindexer = $('<div class="zindexer initialHidden"></div>');
	$zindexer.append($indexUp);
	$zindexer.append($indexDown);

	$zindexed.append($zindexer);
}
