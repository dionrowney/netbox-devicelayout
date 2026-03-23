from django.db import models


class DeviceTypeLayout(models.Model):
    """Stores the physical grid layout for a device type."""

    device_type = models.OneToOneField(
        to="dcim.DeviceType",
        on_delete=models.CASCADE,
        related_name="deviceview2_layout",
    )
    # JSON schema:
    # {
    #   "rows": 2,
    #   "cols": 24,
    #   "cells": [
    #     {
    #       "row": 0,        (0-based)
    #       "col": 0,        (0-based)
    #       "col_span": 2,
    #       "row_span": 1,
    #       "type": "interface",   # interface|front_port|rear_port|console_port|
    #                               # console_server_port|power_port|power_outlet|module_bay
    #       "object_id": 42,
    #       "name": "Gi0/0"
    #     }
    #   ]
    # }
    layout = models.JSONField(default=dict, blank=True)
    modified = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Device Type Layout"
        verbose_name_plural = "Device Type Layouts"

    def __str__(self):
        return f"Layout for {self.device_type}"


class ModuleTypeLayout(models.Model):
    """Stores the physical grid layout for a module type."""

    module_type = models.OneToOneField(
        to="dcim.ModuleType",
        on_delete=models.CASCADE,
        related_name="deviceview2_layout",
    )
    layout = models.JSONField(default=dict, blank=True)
    modified = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Module Type Layout"
        verbose_name_plural = "Module Type Layouts"

    def __str__(self):
        return f"Layout for {self.module_type}"
