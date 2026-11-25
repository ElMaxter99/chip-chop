// Demo app (AngularJS 1.x): ngRoute with #! URLs, templates loaded with templateUrl,
// $http against a backend that chip-chop mocks, a form and a confirmation modal.
(function () {
  "use strict";

  var app = angular.module("vault", ["ngRoute"]);

  app.config(["$routeProvider", "$locationProvider", function ($routeProvider, $locationProvider) {
    $locationProvider.hashPrefix("!");
    $routeProvider
      .when("/login", { templateUrl: "views/login.html", controller: "LoginCtrl", controllerAs: "vm" })
      .when("/home", { templateUrl: "views/home.html", controller: "HomeCtrl", controllerAs: "vm" })
      .when("/passwords", { templateUrl: "views/passwords.html", controller: "PasswordsCtrl", controllerAs: "vm" })
      .otherwise({ redirectTo: "/home" });
  }]);

  app.factory("api", ["$http", function ($http) {
    var data = function (r) { return r.data; };
    return {
      login: function (credentials) { return $http.post("/api/login", credentials).then(data); },
      summary: function () { return $http.get("/api/summary").then(data); },
      passwords: function () { return $http.get("/api/passwords").then(data); },
      shareOptions: function () { return $http.get("/api/share-options").then(data); },
      share: function (body) { return $http.post("/api/share", body).then(data); },
      remove: function (id) { return $http["delete"]("/api/passwords/" + id).then(data); }
    };
  }]);

  app.controller("NavCtrl", ["$location", function ($location) {
    this.is = function (path) { return $location.path() === path; };
  }]);

  app.controller("ClockCtrl", ["$interval", function ($interval) {
    var vm = this;
    vm.now = new Date();
    $interval(function () { vm.now = new Date(); }, 1000);
  }]);

  app.controller("LoginCtrl", ["$location", "api", function ($location, api) {
    var vm = this;
    vm.submit = function () {
      vm.error = "";
      api.login({ user: vm.user, pass: vm.pass }).then(function () {
        $location.path("/home");
      }, function () {
        vm.error = "Wrong user or password";
      });
    };
  }]);

  app.controller("HomeCtrl", ["api", function (api) {
    var vm = this;
    api.summary().then(function (s) { vm.summary = s; });
  }]);

  app.controller("PasswordsCtrl", ["$scope", "$document", "api", function ($scope, $document, api) {
    var vm = this;
    vm.loading = true;
    vm.items = [];
    api.passwords().then(function (list) {
      vm.items = list;
      vm.loading = false;
    });

    vm.askShare = function (entry) {
      api.shareOptions().then(function (options) {
        vm.options = options;
        vm.recipient = options[0];
        vm.toShare = entry;
      });
    };
    vm.closeShare = function () { vm.toShare = null; };
    vm.send = function () {
      api.share({ id: vm.toShare.id, recipient: vm.recipient }).then(function () {
        vm.toShare = null;
        vm.shared = true;
      });
    };

    vm.askDelete = function (entry) { vm.toDelete = entry; };
    vm.cancel = function () { vm.toDelete = null; };
    vm.confirmDelete = function () {
      var id = vm.toDelete.id;
      api.remove(id).then(function () {
        vm.items = vm.items.filter(function (p) { return p.id !== id; });
        vm.toDelete = null;
      });
    };

    // A listener outside AngularJS: it has to start a digest by itself.
    function onKey(e) {
      if (e.key === "Escape") $scope.$apply(function () { vm.cancel(); vm.closeShare(); });
    }
    $document.on("keydown", onKey);
    $scope.$on("$destroy", function () { $document.off("keydown", onKey); });
  }]);
})();
